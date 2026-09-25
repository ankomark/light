"""Publishing phase 7: organisation accounts — conferences, unions, churches,
schools, publishing houses and ministries that publish books together.

- Who is who in an organisation (roles, accepted invitations).
- What each role may do: run it (owner, admin), edit every book under its
  name (+ editor), publish your own books under its name (+ author).
- An organisation as the app shows it (profile, counts, your place in it).
"""
from django.db.models import Count, Q
from django.utils.text import slugify

from .models import Organization, OrganizationMember as M, Publication

MAX_ORGS_PER_USER = 10


def role_of(user, org):
    """'owner' / 'admin' / 'editor' / 'author' for an accepted member, else None."""
    if not getattr(user, 'is_authenticated', False):
        return None
    return (M.objects.filter(organization=org, user=user, accepted_at__isnull=False)
            .values_list('role', flat=True).first())


def can_manage(user, org):
    return role_of(user, org) in M.MANAGE_ROLES


def can_publish_under(user, org):
    return role_of(user, org) is not None


def edit_books_q(user):
    """Books this user edits through an organisation (a subquery)."""
    return (Publication.objects.filter(
        organization__members__user_id=getattr(user, 'id', None),
        organization__members__accepted_at__isnull=False,
        organization__members__role__in=M.EDIT_ROLES,
    ).values('pk'))


def unique_slug(name):
    base = slugify(name)[:70] or 'org'
    slug, n = base, 2
    while Organization.objects.filter(slug=slug).exists():
        slug = f'{base}-{n}'
        n += 1
    return slug


def mini(org):
    """The small form a book or a card carries."""
    from . import media
    if org is None:
        return None
    return {'id': org.id, 'slug': org.slug, 'name': org.name, 'kind': org.kind,
            'logo': media.resolve(org.logo) or '', 'is_verified': org.is_verified}


def profile(org, user):
    """An organisation's page: the profile, its counts, and the viewer's place."""
    counts = Organization.objects.filter(pk=org.pk).aggregate(
        members=Count('members', filter=Q(members__accepted_at__isnull=False), distinct=True),
        followers=Count('followers', distinct=True),
        books=Count('publications', filter=Q(publications__status='published', publications__is_removed=False),
                    distinct=True),
    )
    role = role_of(user, org)
    pending = None
    if getattr(user, 'is_authenticated', False) and role is None:
        inv = M.objects.filter(organization=org, user=user, accepted_at__isnull=True).first()
        pending = inv.role if inv else None
    return {
        **mini(org),
        'description': org.description, 'website': org.website, 'location': org.location,
        'members_count': counts['members'], 'followers_count': counts['followers'], 'books_count': counts['books'],
        'my_role': role, 'invited_as': pending,
        'is_following': bool(getattr(user, 'is_authenticated', False)
                             and org.followers.filter(pk=user.pk).exists()),
        'created_at': org.created_at,
    }


def member_row(m):
    from .serializers import SimpleUserSerializer
    return {'id': m.id, 'user': SimpleUserSerializer(m.user).data, 'role': m.role, 'accepted': m.accepted_at is not None}
