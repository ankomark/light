from .common import *  # noqa: F401,F403


class ProductCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductCategory
        fields = '__all__'



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



class ProductSerializer(serializers.ModelSerializer):
    seller = serializers.SerializerMethodField()
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
    is_owner = serializers.SerializerMethodField()
    average_rating = serializers.SerializerMethodField()
    review_count = serializers.SerializerMethodField()
    is_wishlisted = serializers.SerializerMethodField()
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
        ]
        read_only_fields = ['seller', 'created_at', 'updated_at', 'views', 'slug']

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

    # The three below read annotations set by ProductViewSet.get_queryset() —
    # computing them per object would be an N+1 across a page of products. When
    # ProductSerializer is nested somewhere unannotated (order/wishlist payloads)
    # they degrade to a direct count/avg rather than silently reporting zero.
    def get_average_rating(self, obj):
        avg = getattr(obj, 'avg_rating', None)
        if avg is None:
            avg = obj.reviews.aggregate(v=Avg('rating'))['v']
        return round(float(avg), 1) if avg is not None else None

    def get_review_count(self, obj):
        count = getattr(obj, 'num_reviews', None)
        return count if count is not None else obj.reviews.count()

    def get_is_wishlisted(self, obj):
        annotated = getattr(obj, 'wishlisted_by_me', None)
        if annotated is not None:
            return bool(annotated)
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return False
        return obj.wishlisted_by.filter(user=request.user).exists()

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

        return instance



class CartLineProductSerializer(serializers.ModelSerializer):
    """Lean product payload for a cart line. The cart UI only needs the image,
    title, price/currency and stock — so we skip the heavy fields the full
    ProductSerializer carries (description, payment/contact details, track, …),
    keeping the response small. Rides on the prefetched seller/profile/images,
    so it adds no queries."""
    seller = serializers.SerializerMethodField()
    images = ProductImageSerializer(many=True, read_only=True)

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
    
    class Meta:
        model = Cart
        fields = ['id', 'user', 'created_at', 'updated_at', 'items', 'subtotal', 'total_items']
        read_only_fields = ['user', 'created_at', 'updated_at']
    
    def get_subtotal(self, obj):
        return sum(item.product.price * item.quantity for item in obj.items.all())

    def get_total_items(self, obj):
        # Reuse the prefetched items instead of issuing a separate COUNT query.
        return len(obj.items.all())



class OrderItemSerializer(serializers.ModelSerializer):
    product = ProductSerializer(read_only=True)
    total_price = serializers.SerializerMethodField()
    
    class Meta:
        model = OrderItem
        fields = [
            'id', 'product', 'quantity', 'price_at_purchase', 'total_price', 'seller',
            'payment_confirmed_at',
        ]
        read_only_fields = ['price_at_purchase', 'seller', 'payment_confirmed_at']
    
    def get_total_price(self, obj):
        return obj.price_at_purchase * obj.quantity



class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)
    buyer = UserSerializer(read_only=True)

    class Meta:
        model = Order
        fields = [
            'id', 'buyer', 'status', 'payment_status', 'shipping_address',
            'payment_method', 'total_amount', 'created_at', 'updated_at',
            'transaction_id', 'items'
        ]
        # Everything is read-only over the API: orders mutate only through the
        # gated checkout/set-shipping/update_status paths and the Stripe webhook,
        # never by a client writing these fields directly (payment_status/status/
        # total_amount/transaction_id are integrity-critical).
        read_only_fields = fields



class ProductReviewSerializer(serializers.ModelSerializer):
    # SimpleUserSerializer, not UserSerializer: the full one pulls the reviewer's
    # whole social-post history plus ~5 COUNT queries per review.
    reviewer = SimpleUserSerializer(read_only=True)

    class Meta:
        model = ProductReview
        fields = ['id', 'product', 'reviewer', 'rating', 'comment', 'created_at']
        # 'product' comes from the nested route, never the request body — a
        # writable field here would let a caller review some other product.
        read_only_fields = ['product', 'reviewer', 'created_at']



class WishlistSerializer(serializers.ModelSerializer):
    products = ProductSerializer(many=True, read_only=True)
    
    class Meta:
        model = Wishlist
        fields = ['id', 'user', 'products', 'created_at']
        read_only_fields = ['user', 'created_at']

