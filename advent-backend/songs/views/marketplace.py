from .common import *  # noqa: F401,F403
from rest_framework import mixins
from rest_framework.exceptions import APIException
from decimal import Decimal, InvalidOperation

from django.db.models import Sum
from ..models import SellerProfile
from ..serializers.marketplace import SellerProfileSerializer, money_totals

from django.db.models import Avg, Exists, F, OuterRef
from django.http import Http404

from ..serializers.common import MediaReferenceField


def _image_url(product_images):
    """The first picture of a product, as a URL the app can load."""
    return MediaReferenceField().to_representation(product_images[0].image) if product_images else ''


# How a product list can be sorted: ?sort=<key>.
PRODUCT_SORTS = {
    'new': ('-created_at',),
    'price_low': ('price', '-created_at'),
    'price_high': ('-price', '-created_at'),
    'popular': ('-views', '-created_at'),
    'rating': ('-avg_rating', '-num_reviews', '-created_at'),
}


def bought(user, product):
    """Whether `user` has ordered `product` (an order not cancelled)."""
    if not (user and user.is_authenticated):
        return False
    return OrderItem.objects.filter(
        order__buyer=user, product=product,
    ).exclude(order__status__in=('CANCELLED', 'REFUNDED')).exists()


def settle(order):
    """The order's one status, read from its lines. Each seller's part moves
    on its own (paid, shipped, delivered, cancelled); the order is as far on
    as its slowest part, and cancelled only when every part is."""
    items = list(order.items.all())
    live = [i for i in items if not i.cancelled_at]
    if order.status == 'REFUNDED':
        return order
    if not live:
        status_ = 'CANCELLED'
    elif all(i.delivered_at for i in live):
        status_ = 'DELIVERED'
    elif all(i.shipped_at or i.delivered_at for i in live):
        status_ = 'SHIPPED'
    elif any(i.payment_confirmed_at for i in live):
        status_ = 'PROCESSING'
    else:
        status_ = 'PENDING'
    payment = 'PAID' if live and all(i.payment_confirmed_at for i in live) else order.payment_status
    if (status_, payment) != (order.status, order.payment_status):
        order.status, order.payment_status = status_, payment
        order.save(update_fields=['status', 'payment_status'])
    return order


def tell(user, kind, message, order):
    """A marketplace push about `order` (its own switch: 'marketplace')."""
    if not user:
        return
    try:
        notify_user(user, kind, message, data={'type': kind, 'order_id': order.pk})
    except Exception:  # noqa: BLE001 — a push never undoes an order
        logger.warning('marketplace push failed', exc_info=True)


def _titles(items, limit=3):
    names = [f'{i.quantity}× {i.title or (i.product.title if i.product else "")}' for i in items]
    more = len(names) - limit
    return ', '.join(names[:limit]) + (f' and {more} more' if more > 0 else '')


SHIPPING_MAX = 500


def tell_sellers_of_new_order(order):
    """Each seller hears of their own part of a new order."""
    by_seller = {}
    for item in order.items.select_related('seller', 'product'):
        by_seller.setdefault(item.seller, []).append(item)
    for seller, items in by_seller.items():
        tell(seller, 'market_order',
             f'{order.buyer.username} ordered {_titles(items)}. Order #{order.pk}.', order)


def place_order(user, lines):
    """An order for `lines` [(product, quantity)], each line keeping what
    was bought (title, picture, currency) as it was. Stock is checked here and
    committed later, when each seller confirms they were paid."""
    images = {p.pk: list(p.images.all()) for p in
              Product.objects.filter(pk__in=[p.pk for p, _ in lines]).prefetch_related('images')}
    with transaction.atomic():
        order = Order.objects.create(
            buyer=user, status='PENDING',
            total_amount=sum(p.price * q for p, q in lines),
        )
        OrderItem.objects.bulk_create([
            OrderItem(
                order=order, product=product, quantity=quantity,
                price_at_purchase=product.price, seller=product.seller,
                title=product.title[:200],
                image_url=_image_url(images.get(product.pk) or [])[:500],
                currency=product.currency or 'USD',
            )
            for product, quantity in lines
        ])
        transaction.on_commit(lambda: tell_sellers_of_new_order(order))
    return order


def cannot_buy(user, product):
    """Why `user` cannot put `product` in an order, or None if they can."""
    if product is None or product.is_removed:
        return 'This item is no longer for sale.'
    if product.seller_id == getattr(user, 'pk', None):
        return 'This is your own product.'
    if not product.is_available:
        return f"'{product.title}' is not for sale just now."
    return None


def _decimal(raw):
    try:
        value = Decimal(str(raw))
    except (InvalidOperation, TypeError, ValueError):
        return None
    return value if value >= 0 else None


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

        # The order's own currency, never one the client names: the amount is
        # the order's, and paying a dollar total in shillings must not be
        # possible. An order priced in more than one currency cannot be paid
        # as a single charge.
        currencies = {i.currency or (i.product.currency if i.product else 'USD')
                      for i in order.items.select_related('product')}
        if len(currencies) != 1:
            return Response({'error': 'This order is priced in more than one currency; pay each seller directly.'},
                            status=status.HTTP_400_BAD_REQUEST)
        currency = currencies.pop().lower()
        amount_cents = int((order.total_amount * 100).quantize(Decimal('1')))

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

            # Commit inventory under a row lock to prevent overselling. Goes
            # through OrderItem.commit_stock() so a line already committed by a
            # seller's direct-pay confirmation is never decremented twice.
            now = timezone.now()
            for item in order.items.select_related('product').all():
                item.commit_stock()
                if item.payment_confirmed_at is None:
                    item.payment_confirmed_at = now
                    item.save(update_fields=['payment_confirmed_at'])

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
            .filter(is_removed=False)  # hide moderator takedowns
            .select_related('seller', 'seller__profile', 'seller__seller_profile', 'category')
            .prefetch_related('images')
            # Rating + wishlist state as annotations, so a page of products costs
            # a couple of joins instead of 3 extra queries per product.
            .annotate(
                # A removed review must not count toward the score or the count.
                avg_rating=Avg('reviews__rating', filter=Q(reviews__is_removed=False)),
                num_reviews=Count('reviews', filter=Q(reviews__is_removed=False), distinct=True),
            )
        )
        user = self.request.user
        if user.is_authenticated:
            queryset = queryset.annotate(
                wishlisted_by_me=Exists(
                    Wishlist.objects.filter(user=user, products=OuterRef('pk'))
                )
            )
        params = self.request.query_params
        seller_id = params.get('seller')
        if seller_id:
            if not str(seller_id).isdigit():
                return queryset.none()
            queryset = queryset.filter(seller__id=seller_id)

        if self.action != 'list':
            # A link, an order or the seller's own edit screen must still open
            # a product that has sold out or been taken down by its seller.
            return queryset

        # Near a place: the town the phone knows (the weather's), matched
        # against where sellers said they are.
        near = (params.get('near') or '').strip()
        if near:
            queryset = queryset.filter(location__icontains=near[:60])

        # Browsing shows what can be bought. A seller's own list (the
        # dashboard) shows everything of theirs, sold out or not.
        own = seller_id and user.is_authenticated and str(user.pk) == str(seller_id)
        if not own:
            queryset = queryset.filter(is_available=True, quantity__gt=0)

        # The category the app sends — by id, or by name.
        category = (params.get('category') or '').strip()
        if category:
            queryset = (queryset.filter(category_id=category) if category.isdigit()
                        else queryset.filter(category__name__iexact=category))

        # Search the whole marketplace, not just the page already on the phone.
        q = (params.get('q') or params.get('search') or '').strip()
        if q:
            for term in q.split()[:6]:
                queryset = queryset.filter(
                    Q(title__icontains=term) | Q(description__icontains=term)
                    | Q(category__name__icontains=term) | Q(location__icontains=term)
                )

        low, high = _decimal(params.get('min_price')), _decimal(params.get('max_price'))
        if low is not None:
            queryset = queryset.filter(price__gte=low)
        if high is not None:
            queryset = queryset.filter(price__lte=high)
        for field in ('condition', 'currency'):
            value = (params.get(field) or '').strip().upper()
            if value:
                queryset = queryset.filter(**{field: value})

        return queryset.order_by(*PRODUCT_SORTS.get(params.get('sort') or 'new', PRODUCT_SORTS['new']))

    def retrieve(self, request, *args, **kwargs):
        product = self.get_object()
        user = request.user
        if not (user.is_authenticated and user.pk == product.seller_id):
            who = user.pk if user.is_authenticated else request.META.get('REMOTE_ADDR', '')
            key = f'market:viewed:{product.pk}:{who}'
            if cache.add(key, 1, 60 * 60):
                Product.objects.filter(pk=product.pk).update(views=F('views') + 1)
        # Whether I may review it: only people who bought it can.
        product._can_review = (user.is_authenticated and user.pk != product.seller_id
                               and bought(user, product))
        return Response(self.get_serializer(product).data)

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
    """Anyone may read the categories; only staff may change them. Any
    signed-in user could rename or delete a category before — every product
    in it would have moved or lost its category. Sellers still make a new
    category by naming it on a product (ProductSerializer.create)."""
    serializer_class = ProductCategorySerializer
    pagination_class = None

    def get_permissions(self):
        if self.action in ('list', 'retrieve'):
            return [permissions.AllowAny()]
        return [Cap('manage_marketplace')()]

    def get_queryset(self):
        # With how many products are on offer in each: the home screen shows
        # only categories that have something in them, the fullest first.
        return ProductCategory.objects.annotate(
            product_count=Count('products', filter=Q(
                products__is_removed=False, products__is_available=True,
                products__quantity__gt=0,
            )),
        ).order_by('-product_count', 'name')



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
        # Made on first ask: someone who has never added anything has an empty
        # cart, not a missing one (the app used to read a 404 as "empty").
        Cart.objects.get_or_create(user=request.user)
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
        except (Product.DoesNotExist, ValueError, TypeError):
            return Response(
                {"error": "Product not found"},
                status=status.HTTP_404_NOT_FOUND
            )
        why = cannot_buy(request.user, product)
        if why:
            return Response({"error": why}, status=status.HTTP_400_BAD_REQUEST)

        cart, _ = Cart.objects.get_or_create(user=request.user)
        cart_item = CartItem.objects.filter(cart=cart, product=product).first()
        in_cart = cart_item.quantity if cart_item else 0

        # Cap against stock at ADD time, so a buyer is told immediately instead
        # of building a cart that only fails at checkout (and having to empty it).
        if product.quantity <= 0:
            return Response(
                {"error": "This item is out of stock.", "available": 0, "in_cart": in_cart},
                status=status.HTTP_400_BAD_REQUEST
            )
        if in_cart + quantity > product.quantity:
            detail = f"Only {product.quantity} in stock."
            if in_cart:
                detail = (f"Only {product.quantity} in stock and you already have "
                          f"{in_cart} in your cart.")
            return Response(
                {"error": detail, "available": product.quantity, "in_cart": in_cart},
                status=status.HTTP_400_BAD_REQUEST
            )

        if cart_item:
            cart_item.quantity = in_cart + quantity
            cart_item.save(update_fields=['quantity'])
        else:
            cart_item = CartItem.objects.create(cart=cart, product=product, quantity=quantity)

        return Response(
            {"status": "Item added to cart", "quantity": cart_item.quantity},
            status=status.HTTP_200_OK
        )

    def update_quantity(self, request, pk=None):
        """Set a cart line's quantity (the +/- steppers in the cart). Validated
        against stock so a buyer can dial an over-stock line back down in place
        rather than deleting it. Use DELETE to remove; this rejects quantity < 1."""
        try:
            cart_item = CartItem.objects.select_related('product').get(
                id=pk, cart__user=request.user
            )
        except CartItem.DoesNotExist:
            return Response({"error": "Item not found in cart"}, status=status.HTTP_404_NOT_FOUND)
        try:
            quantity = int(request.data.get('quantity'))
        except (TypeError, ValueError):
            return Response({"error": "Invalid quantity"}, status=status.HTTP_400_BAD_REQUEST)
        if quantity < 1:
            return Response({"error": "Quantity must be at least 1"}, status=status.HTTP_400_BAD_REQUEST)

        available = cart_item.product.quantity
        if quantity > available:
            return Response(
                {"error": f"Only {available} in stock.", "available": available},
                status=status.HTTP_400_BAD_REQUEST
            )
        cart_item.quantity = quantity
        cart_item.save(update_fields=['quantity'])
        return Response(CartItemSerializer(cart_item, context={'request': request}).data)

    @action(detail=False, methods=['post'])
    def buy_now(self, request):
        """POST {product_id, quantity} — an order of just this, straight
        away. The cart is left as it is."""
        product = Product.objects.filter(pk=request.data.get('product_id'), is_removed=False).first()
        if not product:
            return Response({"error": "Product not found"}, status=status.HTTP_404_NOT_FOUND)
        try:
            quantity = int(request.data.get('quantity', 1))
        except (TypeError, ValueError):
            return Response({"error": "Invalid quantity"}, status=status.HTTP_400_BAD_REQUEST)
        if quantity < 1:
            return Response({"error": "Quantity must be at least 1"}, status=status.HTTP_400_BAD_REQUEST)
        why = cannot_buy(request.user, product)
        if why:
            return Response({"error": why}, status=status.HTTP_400_BAD_REQUEST)
        if product.quantity < quantity:
            return Response(
                {"error": f"Only {product.quantity} in stock." if product.quantity else "This item is out of stock.",
                 "available": product.quantity},
                status=status.HTTP_400_BAD_REQUEST,
            )
        order = place_order(request.user, [(product, quantity)])
        return Response(OrderSerializer(order, context={'request': request}).data,
                        status=status.HTTP_201_CREATED)

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
        # (Inventory is only committed once each seller confirms payment.)
        for item in items:
            why = cannot_buy(request.user, item.product)
            if why:
                return Response({"error": why, "item": item.id}, status=status.HTTP_400_BAD_REQUEST)
            if item.quantity > item.product.quantity:
                return Response(
                    {"error": f"Not enough stock for '{item.product.title}' "
                              f"(requested {item.quantity}, available {item.product.quantity})"},
                    status=status.HTTP_400_BAD_REQUEST
                )

        with transaction.atomic():
            order = place_order(request.user, [(item.product, item.quantity) for item in items])
            # Clear the cart. Stock is decremented later, when each seller
            # confirms payment, so an abandoned order never consumes inventory.
            cart.items.all().delete()

        return Response(
            OrderSerializer(order, context={'request': request}).data,
            status=status.HTTP_201_CREATED
        )



class SellerProfileView(APIView):
    """GET/PUT /marketplace/seller-profile/ — my details as a seller, kept
    once and filled into each new product."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        profile, _ = SellerProfile.objects.get_or_create(user=request.user)
        return Response(SellerProfileSerializer(profile).data)

    def put(self, request):
        profile, _ = SellerProfile.objects.get_or_create(user=request.user)
        serializer = SellerProfileSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    patch = put


class ShopView(APIView):
    """GET /marketplace/shops/<username>/ — a seller's shop front: who
    they are, how long they have sold here, what they have on offer, how many
    sales they have made and how their things are rated. Their products come
    from /marketplace/products/?seller=<id>."""
    permission_classes = [permissions.AllowAny]

    def get(self, request, username):
        seller = get_object_or_404(User.objects.select_related('profile'), username=username)
        products = Product.objects.filter(seller=seller, is_removed=False)
        on_offer = products.filter(is_available=True, quantity__gt=0).count()
        sales = OrderItem.objects.filter(seller=seller, payment_confirmed_at__isnull=False,
                                         cancelled_at__isnull=True).count()
        rating = ProductReview.objects.filter(product__seller=seller, is_removed=False).aggregate(
            avg=Avg('rating'), n=Count('id'))
        profile = SellerProfile.objects.filter(user=seller).first()
        first = products.order_by('created_at').values_list('created_at', flat=True).first()
        return Response({
            'seller': SimpleUserSerializer(seller, context={'request': request}).data,
            'is_verified': bool(profile and profile.is_verified),
            'location': (profile.location if profile else '') or
                        (products.exclude(location__isnull=True).exclude(location='')
                         .values_list('location', flat=True).first() or ''),
            'selling_since': first,
            'products_on_offer': on_offer,
            'sales': sales,
            'rating': round(float(rating['avg']), 1) if rating['avg'] is not None else None,
            'review_count': rating['n'],
        })


LOW_STOCK = 2


class OrderPagination(PageNumberPagination):
    """Orders a page at a time: an active seller's whole history, every line
    with its product, came back in one response."""
    page_size = 50
    page_size_query_param = 'page_size'
    max_page_size = 100


class OrderViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    # List/retrieve only — NOT a full ModelViewSet. Orders are created via
    # cart checkout, shipping via set-shipping, and status via update_status
    # (all gated). Exposing default create/update/destroy let a buyer PATCH their
    # own order's payment_status to 'PAID' or force its status, bypassing those
    # checks; payment_status must only ever change via the Stripe webhook.
    serializer_class = OrderSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = OrderPagination

    def get_queryset(self):
        # Prefetch the item → product graph (and buyer) so order lists/details
        # don't re-query the seller/images/category for every line item.
        user = self.request.user
        queryset = (
            Order.objects
            .filter(Q(buyer=user) | Q(items__seller=user))
            .distinct()
            .select_related('buyer', 'buyer__profile')
            .prefetch_related(
                'items__product__images',
                'items__product__seller__profile',
            )
            .order_by('-created_at')
        )
        # ?role=buyer -> only orders I placed (My Orders); ?role=seller -> only
        # orders containing something I sell (Seller Dashboard). Without it, a
        # user who both buys and sells would see purchases and sales mixed into
        # both screens. Detail actions ignore role (the base filter already
        # scopes to buyer-or-seller).
        if self.action == 'list':
            role = self.request.query_params.get('role')
            if role == 'buyer':
                queryset = queryset.filter(buyer=user)
            elif role == 'seller':
                queryset = queryset.filter(items__seller=user).distinct()
        return queryset

    @action(detail=True, methods=['post'], url_path='set-shipping')
    def set_shipping(self, request, pk=None):
        """Buyer saves/updates the delivery address or note for their order.
        The sellers still to send something hear of it: it is where to send."""
        order = self.get_object()
        if order.buyer != request.user:
            return Response(
                {"error": "Only the buyer can set the shipping address"},
                status=status.HTTP_403_FORBIDDEN
            )
        address = request.data.get('shipping_address', '')
        address = address.strip() if isinstance(address, str) else ''
        if not address:
            return Response({"error": "shipping_address is required"}, status=status.HTTP_400_BAD_REQUEST)
        if len(address) > SHIPPING_MAX:
            return Response({"error": f"Keep the delivery note under {SHIPPING_MAX} characters."},
                            status=status.HTTP_400_BAD_REQUEST)
        if order.status == 'CANCELLED':
            return Response({"error": "This order was cancelled."}, status=status.HTTP_400_BAD_REQUEST)
        if address != order.shipping_address:
            order.shipping_address = address
            order.save(update_fields=['shipping_address'])
            waiting = {i.seller for i in order.items.select_related('seller')
                       if not (i.cancelled_at or i.shipped_at or i.delivered_at)}
            for seller in waiting:
                tell(seller, 'market_order',
                     f'{order.buyer.username} added delivery details to order #{order.pk}.', order)
        return Response(OrderSerializer(order, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='confirm-payment')
    def confirm_payment(self, request, pk=None):
        """Direct-pay fulfilment. Buyers pay each seller off-platform, so THIS —
        not the Stripe webhook — is what marks a line paid and commits its stock.

        Scoped to the caller's own line items: an order can span several sellers,
        and each confirms only their own. The order as a whole becomes PAID once
        every line has been confirmed."""
        order = self.get_object()

        with transaction.atomic():
            order = Order.objects.select_for_update().get(pk=order.pk)

            if order.status in ('CANCELLED', 'REFUNDED'):
                return Response(
                    {"error": f"This order is {order.status.lower()} and can no longer be confirmed"},
                    status=status.HTTP_400_BAD_REQUEST
                )

            items = list(order.items.select_related('product').filter(seller=request.user))
            if not items:
                return Response(
                    {"error": "You have no items in this order"},
                    status=status.HTTP_403_FORBIDDEN
                )
            # A cancelled part is over: confirming it would take stock back
            # out for something nobody is buying.
            items = [i for i in items if not i.cancelled_at]
            if not items:
                return Response({"error": "Your part of this order was cancelled.", "code": "cancelled"},
                                status=status.HTTP_400_BAD_REQUEST)

            pending = [i for i in items if i.payment_confirmed_at is None]
            if pending:
                # Nothing was reserved at checkout, so stock must be re-checked
                # here — this is the point where overselling would otherwise happen.
                for item in pending:
                    if item.product and item.quantity > item.product.quantity:
                        return Response(
                            {"error": f"Not enough stock left for '{item.product.title}' "
                                      f"(ordered {item.quantity}, available {item.product.quantity})"},
                            status=status.HTTP_400_BAD_REQUEST
                        )

                now = timezone.now()
                for item in pending:
                    item.payment_confirmed_at = now
                    item.save(update_fields=['payment_confirmed_at'])
                    item.commit_stock()

                # PAID once every seller on the order has confirmed.
                settle(order)
                tell(order.buyer, 'market_paid',
                     f'{request.user.username} confirmed your payment for order #{order.pk}.', order)

        order.refresh_from_db()
        return Response(OrderSerializer(order, context={'request': request}).data)

    @action(detail=False, methods=['get'], url_path='seller-stats')
    def seller_stats(self, request):
        """The seller dashboard's numbers, in one request: sales this week and
        all told (per currency — confirmed payments only), orders waiting for
        me to confirm payment or to send, and what is running low."""
        from datetime import timedelta
        user = request.user
        lines = OrderItem.objects.filter(seller=user, cancelled_at__isnull=True)
        paid = lines.filter(payment_confirmed_at__isnull=False)
        week = paid.filter(payment_confirmed_at__gte=timezone.now() - timedelta(days=7))

        def totals(qs):
            # Summed by the database, per currency — not every line read back.
            rows = (qs.values('currency')
                    .annotate(amount=Sum(F('price_at_purchase') * F('quantity')))
                    .order_by('currency'))
            return money_totals((r['currency'], r['amount'] or 0) for r in rows)

        mine = Product.objects.filter(seller=user, is_removed=False)
        low = (mine.filter(is_available=True, quantity__lte=LOW_STOCK)
               .order_by('quantity', 'title').values('id', 'slug', 'title', 'quantity')[:10])
        return Response({
            'week': totals(week),
            'all_time': totals(paid),
            'awaiting_payment': lines.filter(payment_confirmed_at__isnull=True)
                                     .values('order').distinct().count(),
            'to_send': paid.filter(shipped_at__isnull=True, delivered_at__isnull=True)
                           .values('order').distinct().count(),
            'products': mine.count(),
            'views': mine.aggregate(n=Sum('views'))['n'] or 0,
            'low_stock': list(low),
        })

    # ── each seller's part, on its own ───────────────────────────────────────

    @action(detail=True, methods=['post'])
    def ship(self, request, pk=None):
        """POST {note} — a seller sends their part: after they have been paid.
        The note (the rider, the bus, a tracking number) goes to the buyer."""
        order = self.get_object()
        with transaction.atomic():
            order = Order.objects.select_for_update().get(pk=order.pk)
            items = order.items.filter(seller=request.user, cancelled_at__isnull=True)
            if not items.exists():
                return Response({"error": "You have no items in this order", "code": "not_yours"},
                                status=status.HTTP_403_FORBIDDEN)
            if items.filter(payment_confirmed_at__isnull=True).exists():
                return Response({"error": "Confirm you were paid before sending it.", "code": "not_paid"},
                                status=status.HTTP_400_BAD_REQUEST)
            note = str(request.data.get('note') or '').strip()[:200]
            items.filter(shipped_at__isnull=True).update(shipped_at=timezone.now(), tracking_note=note)
            if note:
                items.update(tracking_note=note)
            settle(order)
        tell(order.buyer, 'market_shipped',
             f'{request.user.username} has sent your order #{order.pk}.' + (f' {note}' if note else ''), order)
        return Response(OrderSerializer(order, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def received(self, request, pk=None):
        """POST {seller_id?} — it arrived. The buyer says so for one seller's
        part (or all that were sent); a seller may for their own, handed over."""
        order = self.get_object()
        with transaction.atomic():
            order = Order.objects.select_for_update().get(pk=order.pk)
            items = order.items.filter(cancelled_at__isnull=True, delivered_at__isnull=True)
            if order.buyer_id == request.user.pk:
                seller_id = request.data.get('seller_id')
                if seller_id:
                    items = items.filter(seller_id=seller_id)
            else:
                items = items.filter(seller=request.user)
                if not order.items.filter(seller=request.user).exists():
                    return Response({"error": "You have no items in this order", "code": "not_yours"},
                                    status=status.HTTP_403_FORBIDDEN)
            items = list(items.select_related('seller'))
            now = timezone.now()
            OrderItem.objects.filter(pk__in=[i.pk for i in items]).update(delivered_at=now)
            settle(order)
        if order.buyer_id == request.user.pk:
            for seller in {i.seller for i in items if i.seller}:
                tell(seller, 'market_delivered',
                     f'{request.user.username} received their order #{order.pk}.', order)
        elif items:
            tell(order.buyer, 'market_delivered',
                 f'{request.user.username} marked your order #{order.pk} delivered.', order)
        return Response(OrderSerializer(order, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='cancel-part')
    def cancel_part(self, request, pk=None):
        """POST {seller_id} — cancel one seller's part and leave the rest.

        The buyer can, until that seller has confirmed payment (after that,
        money has changed hands off the app); a seller can cancel their own
        part until it is sent, and any stock it took goes back."""
        order = self.get_object()
        with transaction.atomic():
            order = Order.objects.select_for_update().get(pk=order.pk)
            if order.buyer_id == request.user.pk:
                items = order.items.filter(seller_id=request.data.get('seller_id'))
                if items.filter(payment_confirmed_at__isnull=False).exists():
                    return Response({"error": "This seller has already confirmed your payment. "
                                              "Contact them to sort it out.", "code": "paid"},
                                    status=status.HTTP_400_BAD_REQUEST)
                other = None
            else:
                items = order.items.filter(seller=request.user)
                other = order.buyer
            items = list(items.filter(cancelled_at__isnull=True).select_related('product', 'seller'))
            if not items:
                return Response({"error": "Nothing to cancel", "code": "nothing"},
                                status=status.HTTP_400_BAD_REQUEST)
            if any(i.shipped_at or i.delivered_at for i in items):
                return Response({"error": "It has already been sent.", "code": "sent"},
                                status=status.HTTP_400_BAD_REQUEST)
            now = timezone.now()
            for item in items:
                item.release_stock()
                item.cancelled_at = now
                item.save(update_fields=['cancelled_at'])
            settle(order)
        if other:
            tell(other, 'market_cancelled',
                 f'{request.user.username} cancelled their part of order #{order.pk}.', order)
        else:
            for seller in {i.seller for i in items if i.seller}:
                tell(seller, 'market_cancelled',
                     f'{request.user.username} cancelled order #{order.pk} with you.', order)
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
        # An order can span several sellers but has ONE shared status field, so
        # who may cancel it is deliberately narrow: only the buyer (owns the whole
        # order) or a sole seller (owns every line). Otherwise one seller could
        # cancel the order and hand back another seller's already-committed stock.
        is_sole_seller = is_seller and not order.items.exclude(seller=request.user).exists()
        cancelling = new_status in ('CANCELLED', 'REFUNDED')

        if is_buyer and not is_seller:
            # Buyers may only cancel, and only before any seller has confirmed
            # payment — in direct-pay a confirmed line means money already changed
            # hands off-platform, which the app can't unwind.
            if not cancelling:
                return Response(
                    {"error": "Buyers can only cancel an order"},
                    status=status.HTTP_403_FORBIDDEN
                )
            if order.status not in ('PENDING', 'PROCESSING'):
                return Response(
                    {"error": "This order can no longer be cancelled"},
                    status=status.HTTP_400_BAD_REQUEST
                )
            if order.items.filter(payment_confirmed_at__isnull=False).exists():
                return Response(
                    {"error": "A seller has already confirmed payment on this order. "
                              "Contact them to resolve it."},
                    status=status.HTTP_400_BAD_REQUEST
                )
        elif is_seller:
            # Sellers drive fulfilment (PROCESSING/SHIPPED/DELIVERED) freely, but
            # may only cancel/refund an order they solely own — a partial cancel
            # of a multi-seller order isn't representable in the shared status.
            if cancelling and not is_sole_seller:
                return Response(
                    {"error": "This order has items from other sellers, so you can't cancel "
                              "the whole order. Contact the buyer to resolve your part."},
                    status=status.HTTP_403_FORBIDDEN
                )
        else:
            return Response(
                {"error": "You don't have permission to update this order"},
                status=status.HTTP_403_FORBIDDEN
            )

        with transaction.atomic():
            order = Order.objects.select_for_update().get(pk=order.pk)
            # Cancelling/refunding hands committed inventory back. Only the buyer
            # or a sole seller reaches this, so every released line belongs to the
            # actor — a seller can never release another seller's stock.
            now = timezone.now()
            mine = order.items.all() if cancelling and is_buyer else order.items.filter(seller=request.user)
            if cancelling:
                for item in order.items.select_related('product').all():
                    item.release_stock()
                order.items.filter(cancelled_at__isnull=True).update(cancelled_at=now)
            elif new_status == 'SHIPPED':
                mine.filter(shipped_at__isnull=True).update(shipped_at=now)
            elif new_status == 'DELIVERED':
                mine.filter(delivered_at__isnull=True).update(delivered_at=now)
            order.status = new_status
            order.save(update_fields=['status'])

        return Response({"status": "Order status updated"}, status=status.HTTP_200_OK)



class ProductReviewViewSet(viewsets.ModelViewSet):
    serializer_class = ProductReviewSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, IsOwnerOrReadOnly]
    owner_field = 'reviewer'

    def _product_slug(self):
        # The nested router builds its kwarg from the PARENT viewset's
        # lookup_field, and ProductViewSet looks products up by slug — so this is
        # 'product_slug', not 'product_pk'. Reading the wrong key silently
        # returned every review in the table and made creates 404.
        return self.kwargs.get('product_slug')

    def get_queryset(self):
        slug = self._product_slug()
        queryset = (
            ProductReview.objects
            .filter(is_removed=False)  # hide moderator takedowns
            .select_related('reviewer', 'reviewer__profile')
            # "Verified buyer": the reviewer ordered it (reviews from before
            # reviewing needed a purchase may not have).
            .annotate(verified=Exists(
                OrderItem.objects.filter(
                    product=OuterRef('product'), order__buyer=OuterRef('reviewer'),
                ).exclude(order__status__in=('CANCELLED', 'REFUNDED'))
            ))
        )
        if slug:
            return queryset.filter(product__slug=slug)
        return queryset.none()  # never leak the whole review table

    def create(self, request, *args, **kwargs):
        # One review per buyer per product (unique_together), so a second POST
        # updates the existing one instead of blowing up on the constraint.
        product = get_object_or_404(Product, slug=self._product_slug())
        # Only people who bought it: a review is worth something because the
        # person writing it had the thing in their hands.
        if not bought(request.user, product):
            return Response(
                {"error": "Only people who bought this can review it.", "code": "not_a_buyer"},
                status=status.HTTP_403_FORBIDDEN,
            )
        existing = ProductReview.objects.filter(product=product, reviewer=request.user).first()
        if existing is not None:
            serializer = self.get_serializer(existing, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        product = get_object_or_404(Product, slug=self._product_slug())
        serializer.save(reviewer=self.request.user, product=product)



class WishlistViewSet(viewsets.ModelViewSet):
    serializer_class = WishlistSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Wishlist.objects.filter(user=self.request.user)

    @action(detail=False, methods=['get'], url_path='my_wishlist')
    def my_wishlist(self, request):
        """The caller's single wishlist (user is a OneToOne), created on first
        access. Mirrors cart/my_cart so the client gets one object, not a list."""
        wishlist, _ = Wishlist.objects.get_or_create(user=request.user)
        wishlist = (
            Wishlist.objects
            .prefetch_related(
                'products__images',
                'products__seller__profile',
                'products__category',
            )
            .get(pk=wishlist.pk)
        )
        return Response(self.get_serializer(wishlist).data)

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

        # get_or_create, not get_object_or_404: removing from a wishlist the user
        # never created is a harmless no-op, not a 404.
        wishlist, _ = Wishlist.objects.get_or_create(user=request.user)
        wishlist.products.remove(product)

        return Response(
            {"status": "Product removed from wishlist"},
            status=status.HTTP_200_OK
        )

