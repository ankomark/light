"""The marketplace's fixed categories, and every product moved into one.

Sellers typed their categories, so each spelling made a new one and the
list filled with near-duplicates. This makes the fixed list
(songs/market_categories.py), puts each product in the category its old one
(or, failing that, its title) belongs to, and removes the typed ones, which
are then empty.
"""
from django.db import migrations

# Frozen here: later edits to the live list must not change what this did.
NAMES = [
    'Phones & Tablets', 'Computers & Laptops', 'Electronics', 'Shoes', 'Bags & Accessories',
    'Jewellery & Watches', 'Clothing & Fashion', 'Health & Beauty', 'Books & Bibles',
    'Music & Instruments', 'Furniture', 'Farming & Agriculture', 'Food & Drinks', 'Home & Kitchen',
    'Vehicles & Parts', 'Baby & Kids', 'Sports & Fitness', 'Art & Crafts', 'Services', 'Other',
]


def to_majors(apps, schema_editor):
    from songs.market_categories import major_for
    Category = apps.get_model('songs', 'ProductCategory')
    Product = apps.get_model('songs', 'Product')
    majors = {}
    for name in NAMES:
        majors[name], _ = Category.objects.get_or_create(name=name)
    for product in Product.objects.select_related('category').all():
        old = product.category.name if product.category else ''
        name = major_for(old, product.title)
        if name not in majors:
            name = 'Other'
        if product.category_id != majors[name].pk:
            product.category = majors[name]
            product.save(update_fields=['category'])
    Category.objects.exclude(name__in=NAMES).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0167_products_back_on_sale'),
    ]

    operations = [
        migrations.RunPython(to_majors, migrations.RunPython.noop),
    ]
