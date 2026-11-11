# Generated for the sender option to require a witness photo (#73).

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("signing", "0007_merge_20261021_1149"),
    ]

    operations = [
        migrations.AddField(
            model_name="document",
            name="photo_required",
            field=models.BooleanField(default=False),
        ),
    ]
