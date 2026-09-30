from .common import *  # noqa: F401,F403
from ..models import SellerProfile


class ProductCategorySerializer(serializers.ModelSerializer):
    # How many products are on offer in it: the home screen shows only the
    # categories that have something in them. Annotated in the view.
    product_count = serializers.IntegerField(read_only=True, required=False)

    class Meta:
        model = ProductCategory
        fields = ['id', 'name', 'description', 'icon', 'parent', 'product_count',
                  'created_at', 'updated_at']


def money_totals(pairs):
    """[(currency, amount)] → [{currency, amount}], one entry per currency.

    Prices are in the seller's own currency, so a cart or an order can hold
    shillings and dollars at once. Adding those together gives a number that
    is not a price in anything; this keeps them apart."""
    totals = {}
    for currency, amount in pairs:
        key = currency or 'USD'
        totals[key] = totals.get(key, 0) + amount
    from decimal import Decimal
    # Always to the cent, whatever the database hands back (a sum can lose
    # its decimal places on the way).
    return [{'currency': c, 'amount': str(Decimal(str(a)).quantize(Decimal('0.01')))}
            for c, a in totals.items()]



class ProductImageSerializer(serializers.ModelSerializer):
    image = CloudinaryFieldSerializer(read_only=True)
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = ProductImage
        fields = ['id', 'image', 'image_url', 'is_primary', 'uploaded_at']
        read_only_fields = ['uploaded_at']

    def get_image_url(self, obj):
        request = self.context.get('request')
        if obj.image and request:
            return CloudinaryFieldSerializer().to_representation(obj.image)
        return None



SELLER_FIELDS = [
    'whatsapp_number', 'contact_number', 'location', 'mpesa_number', 'till_number',
    'bank_details', 'payment_instructions',
]


class SellerProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = SellerProfile
        fields = SELLER_FIELDS + ['is_verified', 'updated_at']
        read_only_fields = ['is_verified', 'updated_at']


def seller_verified(user):
    """The staff-given tick, read from a prefetched profile when there is one."""
    try:
        return bool(user.seller_profile.is_verified)
    except (AttributeError, SellerProfile.DoesNotExist):
        return False


class ProductSerializer(serializers.ModelSerializer):
    seller = serializers.SerializerMethodField()
    seller_verified = serializers.SerializerMethodField()
    currency = serializers.CharField(max_length=3)
    images = serializers.ListField(
        child=serializers.ImageField(),
        write_only=True,
        required=False,
        allow_empty=True
    )
    category = serializers.CharField()
    track = serializers.PrimaryKeyRelatedField(
        queryset=Track.objects.all(),
        required=False,
        allow_null=True
    )
    # Declared, with their defaults, because the form that makes a product is
    # multipart (it carries photos): a true/false field left out of a
    # multipart form reads as an unticked box, so every product came out
    # "not for sale" and was never shown to anyone browsing. Left out of a
    # partial update (an edit), they are simply not changed.
    is_available = serializers.BooleanField(required=False, default=True)
    is_digital = serializers.BooleanField(required=False, default=False)
    is_owner = serializers.SerializerMethodField()
    average_rating = serializers.SerializerMethodField()
    review_count = serializers.SerializerMethodField()
    is_wishlisted = serializers.SerializerMethodField()
    # Set on a product's own page only: may the person asking review it?
    can_review = serializers.SerializerMethodField()
    # Ids of this product's existing ProductImage rows to drop on update. Not a
    # model field — write-only, and ListField reads the repeated multipart keys
    # the client sends via getlist().
    remove_images = serializers.ListField(
        child=serializers.IntegerField(),
        write_only=True,
        required=False,
        allow_empty=True
    )

    class Meta:
        model = Product
        fields = [
            'id', 'seller', 'title', 'description', 'price', 'condition',
            'quantity', 'category', 'is_digital', 'is_available', 'created_at',
            'updated_at', 'views', 'slug', 'images', 'remove_images', 'is_owner',
            'average_rating', 'review_count', 'is_wishlisted', 'track', 'currency',
            'whatsapp_number', 'contact_number', 'location',
            'mpesa_number', 'till_number', 'bank_details', 'payment_instructions',
            'can_review', 'seller_verified',
        ]
        read_only_fields = ['seller', 'created_at', 'updated_at', 'views', 'slug']

    def get_seller_verified(self, obj):
        return seller_verified(obj.seller)

    def get_can_review(self, obj):
        return getattr(obj, '_can_review', None)

    def get_seller(self, obj):
        # A product card/detail only needs the seller's id + username (+ avatar).
        # The full UserSerializer would, per product, load the seller's entire
        # social-post history and run ~5 COUNT queries (followers/following/posts) —
        # turning a 20-item page into hundreds of queries. SimpleUserSerializer is
        # flat and rides on the prefetched seller/profile, so it adds no queries.
        try:
            return SimpleUserSerializer(obj.seller, context=self.context).data
        except AttributeError:
            return None

    def get_is_owner(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.seller == request.user
        return False

    # Annotation-only: ProductViewSet.get_queryset() sets these for the product
    # LIST and DETAIL (the only places the app shows a rating / wishlist heart).
    # Nested uses of ProductSerializer — order line items, wishlist entries —
    # don't render them, so we deliberately do NOT fall back to a per-object
    # query: that fallback was a real N+1 (an order with N items, or a wishlist
    # of N products, each fired 3 extra queries). Unannotated -> null/0/false.
    def get_average_rating(self, obj):
        avg = getattr(obj, 'avg_rating', None)
        return round(float(avg), 1) if avg is not None else None

    def get_review_count(self, obj):
        return getattr(obj, 'num_reviews', 0) or 0

    def get_is_wishlisted(self, obj):
        return bool(getattr(obj, 'wishlisted_by_me', False))

    def validate_category(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Category name cannot be empty.")
        if len(value) > 100:
            raise serializers.ValidationError("Category name cannot exceed 100 characters.")
        return value

    def validate(self, data):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            raise serializers.ValidationError("Authenticated user required to create a product.")
        return data

    def create(self, validated_data):
        images = validated_data.pop('images', [])
        # Meaningless on create, but must not survive into Product(**validated_data).
        validated_data.pop('remove_images', None)
        category_name = validated_data.pop('category')
        category, _ = ProductCategory.objects.get_or_create(
            name=category_name,
            defaults={'description': f'Category for {category_name}'}
        )
        # Remove seller from validated_data to avoid duplication
        validated_data.pop('seller', None)
        # Use the authenticated user from the request context
        product = Product.objects.create(
            seller=self.context['request'].user,
            category=category,
            **validated_data
        )
        for image in images:
            ProductImage.objects.create(
                product=product,
                image=r2.upload_file(image, 'products/images'),
            )
        return product

    def to_representation(self, instance):
        representation = super().to_representation(instance)
        representation['images'] = ProductImageSerializer(
            instance.images.all(),
            many=True,
            context=self.context
        ).data
        representation['category'] = instance.category.name if instance.category else None
        return representation

    def update(self, instance, validated_data):
        # Both are write-only helpers, not model fields — pop them before the
        # setattr loop below. ('images' is the reverse FK manager; assigning to
        # it would raise "Direct assignment to the reverse side is prohibited".)
        images = validated_data.pop('images', [])
        remove_ids = validated_data.pop('remove_images', [])

        # For the wishlist alerts: what it was before this change.
        old_price, old_quantity, old_available = instance.price, instance.quantity, instance.is_available

        category_name = validated_data.pop('category', None)
        if category_name:
            category, _ = ProductCategory.objects.get_or_create(
                name=category_name,
                defaults={'description': f'Category for {category_name}'}
            )
            instance.category = category

        # Apply the rest of the updates
        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        instance.save()

        # Scoped to this product, so a caller can't delete another seller's images.
        if remove_ids:
            instance.images.filter(id__in=remove_ids).delete()

        for image in images:
            ProductImage.objects.create(
                product=instance,
                image=r2.upload_file(image, 'products/images'),
            )

        # Cheaper, or back in stock: the people who saved it hear.
        from ..market_alerts import tell_wishers
        tell_wishers(instance, old_price, old_quantity, old_available)
        return instance



class CartLineProductSerializer(serializers.ModelSerializer):
    """Lean product payload for a cart line. The cart UI only needs the image,
    title, price/currency and stock — so we skip the heavy fields the full
    ProductSerializer carries (description, payment/contact details, track, …),
    keeping the response small. Rides on the prefetched seller/profile/images,
    so it adds no queries."""
    seller = serializers.SerializerMethodField()
    images = ProductImageSerializer(many=True, read_only=True)
    # Taken down by a moderator is not for sale either: the cart says so
    # rather than letting checkout fail on it.
    is_available = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = [
            'id', 'slug', 'title', 'price', 'currency', 'quantity',
            'is_available', 'is_digital', 'seller', 'images',
        ]

    def get_seller(self, obj):
        try:
            return SimpleUserSerializer(obj.seller, context=self.context).data
        except AttributeError:
            return None

    def get_is_available(self, obj):
        return bool(obj.is_available and not obj.is_removed)


class CartItemSerializer(serializers.ModelSerializer):
    product = CartLineProductSerializer(read_only=True)
    total_price = serializers.SerializerMethodField()

    class Meta:
        model = CartItem
        fields = ['id', 'product', 'quantity', 'added_at', 'total_price']
        read_only_fields = ['added_at']

    def get_total_price(self, obj):
        return obj.product.price * obj.quantity



class CartSerializer(serializers.ModelSerializer):
    items = CartItemSerializer(many=True, read_only=True)
    subtotal = serializers.SerializerMethodField()
    total_items = serializers.SerializerMethodField()
    totals = serializers.SerializerMethodField()

    class Meta:
        model = Cart
        fields = ['id', 'user', 'created_at', 'updated_at', 'items', 'subtotal', 'total_items',
                  'totals']
        read_only_fields = ['user', 'created_at', 'updated_at']

    def get_subtotal(self, obj):
        return sum(item.product.price * item.quantity for item in obj.items.all())

    def get_total_items(self, obj):
        # Reuse the prefetched items instead of issuing a separate COUNT query.
        return len(obj.items.all())

    def get_totals(self, obj):
        return money_totals((i.product.currency, i.product.price * i.quantity) for i in obj.items.all())



class OrderLineProductSerializer(CartLineProductSerializer):
    """A product as an order line needs it: what the cart line carries, plus
    the seller's payment and contact details — the buyer pays each seller
    directly, from the order. Not the description, reviews or track."""

    class Meta(CartLineProductSerializer.Meta):
        fields = CartLineProductSerializer.Meta.fields + [
            'whatsapp_number', 'contact_number', 'location',
            'mpesa_number', 'till_number', 'bank_details', 'payment_instructions',
        ]


class OrderItemSerializer(serializers.ModelSerializer):
    product = OrderLineProductSerializer(read_only=True)
    total_price = serializers.SerializerMethodField()
    # As bought — still there when the product is edited or deleted.
    title = serializers.SerializerMethodField()
    image_url = serializers.SerializerMethodField()
    currency = serializers.SerializerMethodField()

    class Meta:
        model = OrderItem
        fields = [
            'id', 'product', 'quantity', 'price_at_purchase', 'total_price', 'seller',
            'payment_confirmed_at', 'title', 'image_url', 'currency',
            'shipped_at', 'delivered_at', 'cancelled_at', 'tracking_note',
        ]
        read_only_fields = ['price_at_purchase', 'seller', 'payment_confirmed_at']

    def get_total_price(self, obj):
        return obj.price_at_purchase * obj.quantity

    def get_title(self, obj):
        return obj.title or (obj.product.title if obj.product else '')

    def get_image_url(self, obj):
        if obj.image_url:
            return obj.image_url
        images = list(obj.product.images.all()) if obj.product else []
        return CloudinaryFieldSerializer().to_representation(images[0].image) if images else ''

    def get_currency(self, obj):
        return obj.currency or (obj.product.currency if obj.product else 'USD')



class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)
    # Who bought it — a name and a picture. The full UserSerializer loaded the
    # buyer's post history and counted followers for every order in a list.
    buyer = SimpleUserSerializer(read_only=True)
    totals = serializers.SerializerMethodField()
    timeline = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = [
            'id', 'buyer', 'status', 'payment_status', 'shipping_address',
            'payment_method', 'total_amount', 'totals', 'created_at', 'updated_at',
            'transaction_id', 'items', 'timeline',
        ]
        # Everything is read-only over the API: orders mutate only through the
        # gated checkout/set-shipping/update_status paths and the Stripe webhook,
        # never by a client writing these fields directly (payment_status/status/
        # total_amount/transaction_id are integrity-critical).
        read_only_fields = fields

    def get_timeline(self, obj):
        """Placed → paid → shipped → delivered: each step with when it was
        reached — for a step every seller's part must have reached it, so
        a two-seller order is "shipped" once both have sent theirs."""
        live = [i for i in obj.items.all() if not i.cancelled_at]
        if not live:
            return [{'step': 'placed', 'at': obj.created_at},
                    {'step': 'cancelled', 'at': max((i.cancelled_at for i in obj.items.all()
                                                     if i.cancelled_at), default=None)}]

        def reached(field):
            stamps = [getattr(i, field) for i in live]
            return max(stamps) if all(stamps) else None

        return [
            {'step': 'placed', 'at': obj.created_at},
            {'step': 'paid', 'at': reached('payment_confirmed_at')},
            {'step': 'shipped', 'at': reached('shipped_at') or reached('delivered_at')},
            {'step': 'delivered', 'at': reached('delivered_at')},
        ]

    def get_totals(self, obj):
        """What the order comes to, per currency (see money_totals).
        `total_amount` is kept for older app builds; with mixed currencies it
        is not a price in anything, and the app does not show it then.

        Lines called off are not owed: the total is what is still live. An
        order called off altogether keeps its old total, to say what it was."""
        items = list(obj.items.all())
        live = [i for i in items if not i.cancelled_at] or items
        return money_totals(
            (i.currency or (i.product.currency if i.product else 'USD'), i.price_at_purchase * i.quantity)
            for i in live
        )



class ProductReviewSerializer(serializers.ModelSerializer):
    # SimpleUserSerializer, not UserSerializer: the full one pulls the reviewer's
    # whole social-post history plus ~5 COUNT queries per review.
    reviewer = SimpleUserSerializer(read_only=True)
    # The UI presents the comment as optional (a star rating alone is valid), so
    # accept a blank/omitted comment instead of rejecting it. The model's
    # TextField stores '' fine; only serializer validation was blocking it.
    comment = serializers.CharField(required=False, allow_blank=True, default='')
    verified = serializers.SerializerMethodField()

    class Meta:
        model = ProductReview
        fields = ['id', 'product', 'reviewer', 'rating', 'comment', 'created_at', 'verified']
        # 'product' comes from the nested route, never the request body — a
        # writable field here would let a caller review some other product.
        read_only_fields = ['product', 'reviewer', 'created_at']

    def get_verified(self, obj):
        return bool(getattr(obj, 'verified', True))



class WishlistSerializer(serializers.ModelSerializer):
    # The card needs a picture, a title, a price and whether it can be bought.
    products = CartLineProductSerializer(many=True, read_only=True)

    class Meta:
        model = Wishlist
        fields = ['id', 'user', 'products', 'created_at']
        read_only_fields = ['user', 'created_at']

