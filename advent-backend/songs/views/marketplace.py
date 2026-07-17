from .common import *  # noqa: F401,F403
from rest_framework import mixins
from rest_framework.exceptions import APIException
from django.http import Http404


class CreatePaymentIntentView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        import stripe
        stripe.api_key = settings.STRIPE_SECRET_KEY
        if not stripe.api_key:
            return Response(
                {'error': 'Payment processing is not configured'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE
            )

        order_id = request.data.get('order_id')
        if not order_id:
            return Response({'error': 'order_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            order = Order.objects.get(id=order_id, buyer=request.user)
        except Order.DoesNotExist:
            return Response({'error': 'Order not found'}, status=status.HTTP_404_NOT_FOUND)

        if order.payment_status == 'PAID':
            return Response({'error': 'This order has already been paid'}, status=status.HTTP_400_BAD_REQUEST)

        # Convert to smallest currency unit (cents for USD/EUR, etc.)
        amount_cents = int(float(order.total_amount) * 100)
        currency = request.data.get('currency', 'usd').lower()

        intent = stripe.PaymentIntent.create(
            amount=amount_cents,
            currency=currency,
            metadata={
                'order_id': str(order.id),
                'user_id': str(request.user.id),
            },
        )
        # Persist the intent id so the webhook can map the event back to this order.
        order.transaction_id = intent.id
        order.save(update_fields=['transaction_id'])

        return Response({
            'client_secret': intent.client_secret,
            'publishable_key': settings.STRIPE_PUBLISHABLE_KEY,
            'amount': float(order.total_amount),
            'currency': currency,
        })



class StripeWebhookView(APIView):
    """Authoritative payment confirmation. Stripe calls this server-to-server;
    it is the ONLY place an order is marked PAID and inventory is committed.
    Signature-verified, idempotent, and atomic under row locks."""
    permission_classes = [AllowAny]

    def post(self, request):
        import stripe
        webhook_secret = settings.STRIPE_WEBHOOK_SECRET
        if not webhook_secret:
            logger.error("Stripe webhook called but STRIPE_WEBHOOK_SECRET is not configured")
            return Response({'error': 'Webhook not configured'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        sig_header = request.META.get('HTTP_STRIPE_SIGNATURE', '')
        try:
            event = stripe.Webhook.construct_event(request.body, sig_header, webhook_secret)
        except (ValueError, stripe.error.SignatureVerificationError) as e:
            logger.warning(f"Invalid Stripe webhook signature: {e}")
            return Response({'error': 'Invalid signature'}, status=status.HTTP_400_BAD_REQUEST)

        event_type = event['type']
        intent = event['data']['object']
        order_id = (intent.get('metadata') or {}).get('order_id')

        if event_type == 'payment_intent.succeeded' and order_id:
            self._fulfill_order(order_id)
        elif event_type == 'payment_intent.payment_failed' and order_id:
            Order.objects.filter(id=order_id, payment_status='PENDING').update(payment_status='FAILED')

        return Response({'received': True})

    @staticmethod
    def _fulfill_order(order_id):
        with transaction.atomic():
            order = Order.objects.select_for_update().filter(id=order_id).first()
            if not order or order.payment_status == 'PAID':
                return  # Unknown order or already fulfilled — idempotent no-op.

            # Commit inventory under a row lock to prevent overselling.
            for item in order.items.select_related('product').all():
                product = item.product
                if product is None:
                    continue
                locked = Product.objects.select_for_update().get(pk=product.pk)
                locked.quantity = max(0, locked.quantity - item.quantity)
                locked.save(update_fields=['quantity'])

            order.payment_status = 'PAID'
            order.status = 'PROCESSING'
            order.save(update_fields=['payment_status', 'status'])



class ProductViewSet(viewsets.ModelViewSet):
    queryset = Product.objects.all().order_by('-created_at')
    serializer_class = ProductSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, IsOwnerOrReadOnly]
    owner_field = 'seller'
    pagination_class = StandardPagination
    lookup_field = 'slug'

    def get_queryset(self):
        # select_related the to-one joins (seller, its profile for the avatar, and
        # category) and prefetch the images so a page of products is served in a
        # handful of queries instead of one-per-product-per-relation (N+1).
        queryset = (
            super().get_queryset()
            .select_related('seller', 'seller__profile', 'category')
            .prefetch_related('images')
        )
        seller_id = self.request.query_params.get('seller')
        if seller_id:
            try:
                queryset = queryset.filter(seller__id=seller_id)
            except ValueError:
                logger.warning(f"Invalid seller ID: {seller_id}")
                return queryset.none()
        return queryset

    def list(self, request, *args, **kwargs):
        try:
            logger.debug(f"Listing products with query params: {request.query_params}")
            return super().list(request, *args, **kwargs)
        except (APIException, Http404):
            # Let DRF render proper 4xx responses (e.g. invalid page -> 404)
            # instead of masking them as a 500.
            raise
        except Exception as e:
            logger.error(f"Error listing products: {str(e)}", exc_info=True)
            return Response(
                {"error": "An unexpected error occurred while fetching products."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def create(self, request, *args, **kwargs):
        logger.debug(f"Received product creation request: {request.data}")
        logger.debug(f"FILES: {request.FILES}")
        if not request.user.is_authenticated:
            logger.error("Unauthenticated user attempted to create a product")
            return Response(
                {"error": "Authentication required to create a product"},
                status=status.HTTP_401_UNAUTHORIZED
            )
        try:
            return super().create(request, *args, **kwargs)
        except (APIException, Http404):
            # Validation / permission / not-found errors must reach the client as
            # their real 4xx (with field errors), not be swallowed into a 500.
            raise
        except Exception as e:
            logger.error(f"Error creating product: {str(e)}", exc_info=True)
            return Response(
                {"error": "An unexpected error occurred while creating the product."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def perform_create(self, serializer):
        # No need to set seller here, as it's handled in the serializer
        serializer.save()

    @action(detail=True, methods=['post'])
    def upload_images(self, request, slug=None):
        logger.debug(f"Received image upload request for slug {slug}: {request.FILES}")
        try:
            product = self.get_object()
            if product.seller != request.user:
                return Response(
                    {"error": "You can only add images to your own products"},
                    status=status.HTTP_403_FORBIDDEN
                )
            images = request.FILES.getlist('images')
            for image in images:
                ProductImage.objects.create(
                    product=product,
                    image=r2.upload_file(image, 'products/images'),
                )
            return Response(
                {"status": "Images uploaded successfully"},
                status=status.HTTP_201_CREATED
            )
        except Exception as e:
            logger.error(f"Error uploading images: {str(e)}", exc_info=True)
            return Response(
                {"error": f"An unexpected error occurred while uploading images: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )



class ProductCategoryViewSet(viewsets.ModelViewSet):
    queryset = ProductCategory.objects.all()
    serializer_class = ProductCategorySerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]



class CartViewSet(viewsets.ModelViewSet):
    serializer_class = CartSerializer
    permission_classes = [permissions.IsAuthenticated]
    
    def get_queryset(self):
        return Cart.objects.filter(user=self.request.user)
    def destroy(self, request, *args, **kwargs):
        # Handle DELETE requests for cart items
        try:
            item_id = kwargs.get('pk')
            cart_item = CartItem.objects.get(id=item_id, cart__user=request.user)
            cart_item.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        except CartItem.DoesNotExist:
            return Response(
                {"error": "Item not found in cart"},
                status=status.HTTP_404_NOT_FOUND
            )
    @action(detail=False, methods=['get'])
    def my_cart(self, request):
        # Prefetch each item's product graph (images + seller/profile + category)
        # so rendering the cart is a few queries rather than N+1 per line item.
        cart = get_object_or_404(
            Cart.objects.prefetch_related(
                'items__product__images',
                'items__product__seller__profile',
                'items__product__category',
            ),
            user=request.user,
        )
        serializer = self.get_serializer(cart)
        return Response(serializer.data)
    
    @action(detail=False, methods=['post'])
    def add_item(self, request):
        product_id = request.data.get('product_id')
        try:
            quantity = int(request.data.get('quantity', 1))
        except (TypeError, ValueError):
            return Response({"error": "Invalid quantity"}, status=status.HTTP_400_BAD_REQUEST)
        if quantity < 1:
            return Response({"error": "Quantity must be at least 1"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            product = Product.objects.get(id=product_id)
        except Product.DoesNotExist:
            return Response(
                {"error": "Product not found"},
                status=status.HTTP_404_NOT_FOUND
            )

        cart, _ = Cart.objects.get_or_create(user=request.user)
        cart_item, created = CartItem.objects.get_or_create(
            cart=cart,
            product=product,
            defaults={'quantity': quantity}
        )

        if not created:
            cart_item.quantity += quantity
            cart_item.save(update_fields=['quantity'])

        return Response(
            {"status": "Item added to cart", "quantity": cart_item.quantity},
            status=status.HTTP_200_OK
        )
    
    @action(detail=False, methods=['post'])
    def checkout(self, request):
        cart = get_object_or_404(Cart, user=request.user)
        
        if cart.items.count() == 0:
            return Response(
                {"error": "Your cart is empty"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        items = list(cart.items.select_related('product').all())

        # Validate stock up front so we don't create an order we can't fulfil.
        # (Inventory is only committed once payment is confirmed by the webhook.)
        for item in items:
            if item.quantity > item.product.quantity:
                return Response(
                    {"error": f"Not enough stock for '{item.product.title}' "
                              f"(requested {item.quantity}, available {item.product.quantity})"},
                    status=status.HTTP_400_BAD_REQUEST
                )

        with transaction.atomic():
            order = Order.objects.create(
                buyer=request.user,
                status='PENDING',
                total_amount=sum(item.product.price * item.quantity for item in items)
            )

            for item in items:
                OrderItem.objects.create(
                    order=order,
                    product=item.product,
                    quantity=item.quantity,
                    price_at_purchase=item.product.price,
                    seller=item.product.seller
                )

            # Clear the cart. Stock is decremented later, by the Stripe webhook,
            # so an abandoned payment never consumes inventory.
            cart.items.all().delete()

        return Response(
            OrderSerializer(order, context={'request': request}).data,
            status=status.HTTP_201_CREATED
        )



class OrderViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    # List/retrieve only — NOT a full ModelViewSet. Orders are created via
    # cart checkout, shipping via set-shipping, and status via update_status
    # (all gated). Exposing default create/update/destroy let a buyer PATCH their
    # own order's payment_status to 'PAID' or force its status, bypassing those
    # checks; payment_status must only ever change via the Stripe webhook.
    serializer_class = OrderSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        # Prefetch the item → product graph (and buyer) so order lists/details
        # don't re-query the seller/images/category for every line item.
        return (
            Order.objects
            .filter(Q(buyer=self.request.user) | Q(items__seller=self.request.user))
            .distinct()
            .select_related('buyer', 'buyer__profile')
            .prefetch_related(
                'items__seller',
                'items__product__images',
                'items__product__seller__profile',
                'items__product__category',
            )
        )

    @action(detail=True, methods=['post'], url_path='set-shipping')
    def set_shipping(self, request, pk=None):
        """Buyer saves/updates the shipping address for their order."""
        order = self.get_object()
        if order.buyer != request.user:
            return Response(
                {"error": "Only the buyer can set the shipping address"},
                status=status.HTTP_403_FORBIDDEN
            )
        address = request.data.get('shipping_address', '').strip()
        if not address:
            return Response({"error": "shipping_address is required"}, status=status.HTTP_400_BAD_REQUEST)
        order.shipping_address = address
        order.save(update_fields=['shipping_address'])
        return Response(OrderSerializer(order, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def update_status(self, request, pk=None):
        order = self.get_object()
        new_status = request.data.get('status')

        if new_status not in dict(Order.STATUS_CHOICES).keys():
            return Response(
                {"error": "Invalid status"},
                status=status.HTTP_400_BAD_REQUEST
            )

        is_seller = order.items.filter(seller=request.user).exists()
        is_buyer = order.buyer == request.user

        # Buyers may only cancel a not-yet-shipped order; sellers drive fulfilment.
        if is_buyer and not is_seller:
            if new_status != 'CANCELLED':
                return Response(
                    {"error": "Buyers can only cancel an order"},
                    status=status.HTTP_403_FORBIDDEN
                )
            if order.status not in ('PENDING', 'PROCESSING'):
                return Response(
                    {"error": "This order can no longer be cancelled"},
                    status=status.HTTP_400_BAD_REQUEST
                )
        elif not is_seller:
            return Response(
                {"error": "You don't have permission to update this order"},
                status=status.HTTP_403_FORBIDDEN
            )

        order.status = new_status
        order.save(update_fields=['status'])
        return Response({"status": "Order status updated"}, status=status.HTTP_200_OK)



class ProductReviewViewSet(viewsets.ModelViewSet):
    serializer_class = ProductReviewSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, IsOwnerOrReadOnly]
    owner_field = 'reviewer'
    
    def get_queryset(self):
        product_id = self.kwargs.get('product_pk')
        if product_id:
            return ProductReview.objects.filter(product_id=product_id)
        return ProductReview.objects.all()
    
    def perform_create(self, serializer):
        product = get_object_or_404(Product, id=self.kwargs.get('product_pk'))
        serializer.save(reviewer=self.request.user, product=product)



class WishlistViewSet(viewsets.ModelViewSet):
    serializer_class = WishlistSerializer
    permission_classes = [permissions.IsAuthenticated]
    
    def get_queryset(self):
        return Wishlist.objects.filter(user=self.request.user)
    
    @action(detail=False, methods=['post'])
    def add_product(self, request):
        product_id = request.data.get('product_id')
        
        try:
            product = Product.objects.get(id=product_id)
        except Product.DoesNotExist:
            return Response(
                {"error": "Product not found"},
                status=status.HTTP_404_NOT_FOUND
            )
        
        wishlist, created = Wishlist.objects.get_or_create(user=request.user)
        wishlist.products.add(product)
        
        return Response(
            {"status": "Product added to wishlist"},
            status=status.HTTP_200_OK
        )
    
    @action(detail=False, methods=['post'])
    def remove_product(self, request):
        product_id = request.data.get('product_id')
        
        try:
            product = Product.objects.get(id=product_id)
        except Product.DoesNotExist:
            return Response(
                {"error": "Product not found"},
                status=status.HTTP_404_NOT_FOUND
            )
        
        wishlist = get_object_or_404(Wishlist, user=request.user)
        wishlist.products.remove(product)
        
        return Response(
            {"status": "Product removed from wishlist"},
            status=status.HTTP_200_OK
        )

