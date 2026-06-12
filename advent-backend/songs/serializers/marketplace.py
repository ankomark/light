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

    class Meta:
        model = Product
        fields = [
            'id', 'seller', 'title', 'description', 'price', 'condition',
            'quantity', 'category', 'is_digital', 'is_available', 'created_at',
            'updated_at', 'views', 'slug', 'images', 'is_owner', 'track', 'currency',
            'whatsapp_number', 'contact_number', 'location',
            'mpesa_number', 'till_number', 'bank_details', 'payment_instructions',
        ]
        read_only_fields = ['seller', 'created_at', 'updated_at', 'views', 'slug']

    def get_seller(self, obj):
        try:
            return UserSerializer(obj.seller, context=self.context).data
        except AttributeError:
            return None

    def get_is_owner(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.seller == request.user
        return False

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
            ProductImage.objects.create(product=product, image=image)
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
        return instance



class CartItemSerializer(serializers.ModelSerializer):
    product = ProductSerializer(read_only=True)
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
        return obj.items.count()



class OrderItemSerializer(serializers.ModelSerializer):
    product = ProductSerializer(read_only=True)
    total_price = serializers.SerializerMethodField()
    
    class Meta:
        model = OrderItem
        fields = ['id', 'product', 'quantity', 'price_at_purchase', 'total_price', 'seller']
        read_only_fields = ['price_at_purchase', 'seller']
    
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
        read_only_fields = ['buyer', 'total_amount', 'created_at', 'updated_at']



class ProductReviewSerializer(serializers.ModelSerializer):
    reviewer = UserSerializer(read_only=True)
    
    class Meta:
        model = ProductReview
        fields = ['id', 'product', 'reviewer', 'rating', 'comment', 'created_at']
        read_only_fields = ['reviewer', 'created_at']



class WishlistSerializer(serializers.ModelSerializer):
    products = ProductSerializer(many=True, read_only=True)
    
    class Meta:
        model = Wishlist
        fields = ['id', 'user', 'products', 'created_at']
        read_only_fields = ['user', 'created_at']

