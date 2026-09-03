"""Fold the Choir and Church community models into the generic Group community.

Choir and Church were near-identical copies of the same community engine
(membership + join requests + chat + moderation), which meant a new kind of
community needed new models, views, screens and a migration. After this, "what
kind of community is this" is a CommunityCategory row, so people create their
own kinds without a code change.

Group is the survivor because it already had the richer engine (slug, invite
codes, join questions, a moderator tier, audit log, post attachments and
reactions, unread counts). The type-specific fields that made a church a church
(conference, district, pastor) move into Group.details, described by the
category's field_schema so the directory filters keep working.
"""
from django.db import migrations
from django.utils.text import slugify


def _text(v):
    return '' if v is None else str(v)


def _schema(*rows):
    """[(key, label, type, filterable, searchable), ...] -> field descriptors."""
    return [
        {'key': k, 'label': lbl, 'type': t, 'filterable': f, 'searchable': s}
        for (k, lbl, t, f, s) in rows
    ]


BUILTIN_CATEGORIES = [
    {
        'name': 'Church', 'slug': 'church', 'icon': 'business',
        'description': 'A local church, its members and its notices.',
        'field_schema': _schema(
            ('country', 'Country', 'text', True, True),
            ('county', 'County / State', 'text', True, True),
            ('conference', 'Conference', 'text', True, True),
            ('district', 'District', 'text', True, True),
            ('location', 'Location', 'text', False, True),
            ('pastor', 'Pastor', 'text', False, True),
            ('contact', 'Contact', 'tel', False, False),
        ),
    },
    {
        'name': 'Choir', 'slug': 'choir', 'icon': 'musical-notes',
        'description': 'A singing group, its repertoire and its members.',
        'field_schema': _schema(
            ('location', 'Location', 'text', True, True),
            ('genre', 'Genre', 'text', True, False),
            ('founded_date', 'Founded', 'date', False, False),
            ('contact_phone', 'Phone', 'tel', False, False),
            ('contact_email', 'Email', 'email', False, False),
            ('youtube_link', 'YouTube', 'url', False, False),
        ),
    },
    {
        'name': 'News', 'slug': 'news', 'icon': 'newspaper',
        'description': 'Trending news and discussion.',
        'field_schema': _schema(('topic', 'Topic', 'text', True, True)),
    },
    {
        'name': 'Youth', 'slug': 'youth', 'icon': 'people',
        'description': 'Youth and young-adult ministry.',
        'field_schema': _schema(('location', 'Location', 'text', True, True)),
    },
    {
        'name': 'Prayer', 'slug': 'prayer', 'icon': 'heart',
        'description': 'Prayer requests and intercession.', 'field_schema': [],
    },
    {
        'name': 'Bible Study', 'slug': 'bible-study', 'icon': 'book',
        'description': 'Studying scripture together.', 'field_schema': [],
    },
    {
        'name': 'Ministry', 'slug': 'ministry', 'icon': 'hand-left',
        'description': 'Outreach, service and ministry teams.',
        'field_schema': _schema(('location', 'Location', 'text', True, True)),
    },
    {
        'name': 'General', 'slug': 'general', 'icon': 'chatbubbles',
        'description': 'Anything that does not fit another category.',
        'field_schema': [],
    },
]


def seed_and_migrate(apps, schema_editor):
    CommunityCategory = apps.get_model('songs', 'CommunityCategory')
    Group = apps.get_model('songs', 'Group')
    GroupMember = apps.get_model('songs', 'GroupMember')
    GroupJoinRequest = apps.get_model('songs', 'GroupJoinRequest')
    GroupPost = apps.get_model('songs', 'GroupPost')
    GroupPostReaction = apps.get_model('songs', 'GroupPostReaction')
    Church = apps.get_model('songs', 'Church')
    Choir = apps.get_model('songs', 'Choir')

    cats = {}
    for spec in BUILTIN_CATEGORIES:
        cats[spec['slug']] = CommunityCategory.objects.get_or_create(
            slug=spec['slug'],
            defaults={
                'name': spec['name'], 'icon': spec['icon'],
                'description': spec['description'],
                'field_schema': spec['field_schema'], 'is_builtin': True,
            },
        )[0]

    # Groups that predate categories land in General so every community has a
    # category and the category filter never hides anything.
    Group.objects.filter(category__isnull=True).update(category=cats['general'])

    taken = set(Group.objects.values_list('slug', flat=True))

    def unique_slug(name):
        base = slugify(name)[:90] or 'community'
        slug, n = base, 1
        while slug in taken:
            slug, n = '%s-%d' % (base, n), n + 1
        taken.add(slug)
        return slug

    def port_community(src, category, name, cover, details, created_at, updated_at):
        """Create the Group standing in for a Choir/Church row."""
        group = Group.objects.create(
            creator_id=src.created_by_id,
            name=name,
            description=details.pop('description', '') or '',
            cover_image=cover or None,
            # Choirs and churches were publicly discoverable, not invite-only.
            is_private=False,
            only_admins_can_post=getattr(src, 'only_admins_can_post', False),
            is_removed=getattr(src, 'is_removed', False),
            slug=unique_slug(name),
            category=category,
            details={k: v for k, v in details.items() if v not in ('', None)},
        )
        # created_at/updated_at are auto_now_add/auto_now, so they ignore values
        # passed to create() — write the originals back explicitly.
        Group.objects.filter(pk=group.pk).update(created_at=created_at, updated_at=updated_at)
        return group

    def port_members(memberships, group):
        for m in memberships:
            GroupMember.objects.get_or_create(
                group=group, user_id=m.user_id,
                defaults={
                    'is_admin': m.role == 'admin',
                    'is_moderator': m.is_moderator,
                    'last_read_at': m.last_read_at,
                },
            )
            GroupMember.objects.filter(group=group, user_id=m.user_id).update(
                joined_at=m.joined_at
            )

    def port_requests(requests, group):
        for r in requests:
            obj, made = GroupJoinRequest.objects.get_or_create(
                group=group, user_id=r.user_id,
                defaults={'message': r.message, 'status': r.status},
            )
            if made:
                GroupJoinRequest.objects.filter(pk=obj.pk).update(created_at=r.created_at)

    def port_messages(messages, group):
        """Returns {old_message_id: new_post_id} so replies and pins can be rewired."""
        id_map = {}
        # Two passes: create every post first, then attach reply_to, since a
        # reply may point at a message created later in the iteration order.
        for msg in messages:
            post = GroupPost.objects.create(
                group=group, user_id=msg.sender_id, content=msg.content,
                message_type=msg.message_type, attachment=msg.attachment,
                attachment_blurhash=msg.attachment_blurhash,
                file_name=msg.file_name, duration=msg.duration,
                edited_at=msg.edited_at, is_removed=msg.is_removed,
            )
            GroupPost.objects.filter(pk=post.pk).update(created_at=msg.created_at)
            id_map[msg.id] = post.id
        for msg in messages:
            if msg.reply_to_id and msg.reply_to_id in id_map:
                GroupPost.objects.filter(pk=id_map[msg.id]).update(
                    reply_to_id=id_map[msg.reply_to_id]
                )
        for msg in messages:
            for rx in msg.reactions.all():
                GroupPostReaction.objects.get_or_create(
                    post_id=id_map[msg.id], user_id=rx.user_id,
                    defaults={'emoji': rx.emoji},
                )
        return id_map

    church_map = {}
    for ch in Church.objects.all():
        group = port_community(
            ch, cats['church'], ch.name, ch.image,
            {
                'country': _text(ch.country), 'county': _text(ch.county),
                'conference': _text(ch.conference), 'district': _text(ch.district),
                'location': _text(ch.location), 'pastor': _text(ch.pastor),
                'contact': _text(ch.contact),
            },
            ch.created_at, ch.updated_at,
        )
        port_members(list(ch.memberships.all()), group)
        port_requests(list(ch.join_requests.all()), group)
        id_map = port_messages(list(ch.messages.all()), group)
        if ch.pinned_message_id and ch.pinned_message_id in id_map:
            Group.objects.filter(pk=group.pk).update(
                pinned_post_id=id_map[ch.pinned_message_id]
            )
        church_map[ch.id] = group

    for cr in Choir.objects.all():
        group = port_community(
            cr, cats['choir'], cr.name, cr.cover_image or cr.profile_image,
            {
                'description': _text(cr.description),
                'location': _text(cr.location), 'genre': _text(cr.genre),
                'founded_date': cr.founded_date.isoformat() if cr.founded_date else '',
                'contact_phone': _text(cr.contact_phone),
                'contact_email': _text(cr.contact_email),
                'youtube_link': _text(cr.youtube_link),
                'profile_image': _text(cr.profile_image),
            },
            cr.created_at, cr.updated_at,
        )
        # A choir that belonged to a church becomes a child of that community.
        if cr.church_id and cr.church_id in church_map:
            Group.objects.filter(pk=group.pk).update(
                parent_id=church_map[cr.church_id].pk
            )
        port_members(list(cr.memberships.all()), group)
        port_requests(list(cr.join_requests.all()), group)
        id_map = port_messages(list(cr.messages.all()), group)
        if cr.pinned_message_id and cr.pinned_message_id in id_map:
            Group.objects.filter(pk=group.pk).update(
                pinned_post_id=id_map[cr.pinned_message_id]
            )


def unmigrate(apps, schema_editor):
    """The Choir/Church tables are dropped by the next migration, so there is
    nothing to restore into — reversing only clears what this created."""
    apps.get_model('songs', 'CommunityCategory').objects.filter(is_builtin=True).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('songs', '0096_group_details_group_parent_communitycategory_and_more'),
    ]

    operations = [
        migrations.RunPython(seed_and_migrate, unmigrate),
    ]
