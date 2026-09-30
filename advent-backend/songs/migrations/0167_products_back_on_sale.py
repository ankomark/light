"""Put back on sale the products the multipart bug took off it.

Every product made from the app was saved with is_available = False: the
form is multipart (it carries photos) and leaves the field out, and a
true/false field left out of a multipart form reads as an unticked box
(fixed in ProductSerializer). Until browsing started hiding products that
are not for sale, nobody noticed — then no one's products showed at all.

Before this release the app had no way to take a product off sale on
purpose, so every product saved "not for sale" was saved so by the bug.
"""
from django.db import migrations


def back_on_sale(apps, schema_editor):
    Product = apps.get_model('songs', 'Product')
    Product.objects.filter(is_available=False, is_removed=False).update(is_available=True)


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0166_quiet_hours'),
    ]

    operations = [
        migrations.RunPython(back_on_sale, migrations.RunPython.noop),
    ]
