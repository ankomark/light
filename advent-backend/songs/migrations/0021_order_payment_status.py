from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0020_socialpost_view_count_passwordresetcode'),
    ]

    operations = [
        migrations.AddField(
            model_name='order',
            name='payment_status',
            field=models.CharField(
                choices=[('PENDING', 'Pending'), ('PAID', 'Paid'), ('FAILED', 'Failed')],
                default='PENDING',
                max_length=20,
            ),
        ),
    ]
