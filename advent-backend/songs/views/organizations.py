"""Organisation accounts (songs/organizations.py): conferences, unions,
churches, schools, publishing houses and ministries that publish books.

    GET    /organizations/?q=&kind=&mine=1        find them (yours with mine=1)
    POST   /organizations/                        start one (you're its owner)
    GET    /organizations/<slug>/                 its page
    PATCH  /organizations/<slug>/                 its profile (owner, admins)
    DELETE /organizations/<slug>/                 close it (owner)
    POST / DELETE /organizations/<slug>/follow/   follow it
    GET  /organizations/<slug>/members/           who's in it (+ invitations, for those who run it)
    POST /organizations/<slug>/members/           invite {username, role}
    PATCH / DELETE /organizations/<slug>/members/<id>/   change a role / remove (or leave)
    POST /organizations/<slug>/respond/ {accept}  answer an invitation
    GET  /organizations/invitations/              yours, waiting
"""
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from .. import organizations as orgs, r2
from ..models import Organization, OrganizationMember as M, User, blocked_ids_for
from .common import StandardPagination

KINDS = dict(Organization.KINDS)


def _clean(data, partial):
    """The profile fields from a request, checked. → (fields, error)."""
    out = {}
    if 'name' in data or not partial:
        name = ' '.join(str(data.get('name') or '').split())[:120]
        if len(name) < 2:
            return None, 'An organisation needs a name.'
        out['name'] = name
    if 'kind' in data or not partial:
        kind = str(data.get('kind') or 'other')
        if kind not in KINDS:
            return None, 'Unknown kind of organisation.'
        out['kind'] = kind
    for f, n in (('description', 2000), ('location', 120), ('logo', 500)):
        if f in data:
            out[f] = str(data.get(f) or '').strip()[:n]
    # A logo is one of our uploads — not any address on the internet.
    if out.get('logo') and not r2.is_r2_url(out['logo']):
        return None, 'Upload the logo from the app.'
    if 'website' in data:
        site = str(data.get('website') or '').strip()[:300]
        if site and not site.lower().startswith(('http://', 'https://')):
            site = f'https://{site}'
        out['website'] = site
    return out, None


class OrganizationViewSet(viewsets.GenericViewSet):
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    pagination_class = StandardPagination
    lookup_field = 'slug'
    queryset = Organization.objects.all()

    def _row(self, org):
        return {**orgs.mini(org), 'location': org.location,
                'books_count': getattr(org, 'books_n', None), 'followers_count': getattr(org, 'followers_n', None)}

    def list(self, request):
        qs = Organization.objects.annotate(
            books_n=Count('publications', filter=Q(publications__status='published', publications__is_removed=False),
                          distinct=True),
            followers_n=Count('followers', distinct=True),
        )
        if request.query_params.get('mine'):
            if not request.user.is_authenticated:
                return Response({'results': [], 'next': None})
            qs = qs.filter(members__user=request.user, members__accepted_at__isnull=False)
        q = (request.query_params.get('q') or '').strip()
        if q:
            qs = qs.filter(Q(name__icontains=q) | Q(location__icontains=q))
        kind = request.query_params.get('kind')
        if kind in KINDS:
            qs = qs.filter(kind=kind)
        # Verified first, then those with the most books out.
        qs = qs.order_by('-is_verified', '-books_n', 'name')
        page = self.paginate_queryset(qs)
        return self.get_paginated_response([self._row(o) for o in page])

    def create(self, request):
        fields, err = _clean(request.data, partial=False)
        if err:
            return Response({'error': err}, status=status.HTTP_400_BAD_REQUEST)
        # A verified organisation's name isn't anyone else's to take.
        if Organization.objects.filter(is_verified=True, name__iexact=fields['name']).exists():
            return Response({'error': 'An organisation with this name is already verified.', 'code': 'name_taken'},
                            status=status.HTTP_400_BAD_REQUEST)
        if M.objects.filter(user=request.user, role=M.OWNER).count() >= orgs.MAX_ORGS_PER_USER:
            return Response({'error': 'You run as many organisations as one person may.'},
                            status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            org = Organization.objects.create(slug=orgs.unique_slug(fields['name']), created_by=request.user, **fields)
            M.objects.create(organization=org, user=request.user, role=M.OWNER, accepted_at=timezone.now())
        return Response(orgs.profile(org, request.user), status=status.HTTP_201_CREATED)

    def retrieve(self, request, slug=None):
        return Response(orgs.profile(self.get_object(), request.user))

    def partial_update(self, request, slug=None):
        org = self.get_object()
        if not orgs.can_manage(request.user, org):
            raise PermissionDenied('Only those who run the organisation can change it.')
        fields, err = _clean(request.data, partial=True)
        if err:
            return Response({'error': err}, status=status.HTTP_400_BAD_REQUEST)
        if ('name' in fields and not org.is_verified and Organization.objects.filter(
                is_verified=True, name__iexact=fields['name']).exclude(pk=org.pk).exists()):
            return Response({'error': 'An organisation with this name is already verified.', 'code': 'name_taken'},
                            status=status.HTTP_400_BAD_REQUEST)
        for k, v in fields.items():
            setattr(org, k, v)
        org.save()
        return Response(orgs.profile(org, request.user))

    def destroy(self, request, slug=None):
        org = self.get_object()
        if orgs.role_of(request.user, org) != M.OWNER:
            raise PermissionDenied('Only the owner can close the organisation.')
        org.delete()          # its books stay, under their authors' names
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post', 'delete'], permission_classes=[permissions.IsAuthenticated])
    def follow(self, request, slug=None):
        org = self.get_object()
        if request.method == 'POST':
            org.followers.add(request.user)
        else:
            org.followers.remove(request.user)
        return Response({'is_following': request.method == 'POST', 'followers_count': org.followers.count()})

    # ── Members ──

    @action(detail=True, methods=['get', 'post'])
    def members(self, request, slug=None):
        org = self.get_object()
        manages = orgs.can_manage(request.user, org)
        if request.method == 'GET':
            rows = org.members.select_related('user', 'user__profile').order_by('accepted_at', 'id')
            if not manages:
                rows = rows.filter(accepted_at__isnull=False)     # invitations are theirs to see
            return Response({'results': [orgs.member_row(m) for m in rows],
                             'my_role': orgs.role_of(request.user, org)})
        if not manages:
            raise PermissionDenied('Only those who run the organisation invite.')
        role = request.data.get('role') or M.AUTHOR
        if role not in dict(M.ROLES) or role == M.OWNER:
            return Response({'error': 'Unknown role.'}, status=status.HTTP_400_BAD_REQUEST)
        if role == M.ADMIN and orgs.role_of(request.user, org) != M.OWNER:
            raise PermissionDenied('Only the owner makes admins.')
        who = User.objects.filter(username__iexact=str(request.data.get('username') or '').strip().lstrip('@'),
                                  is_deactivated=False).first()
        if who is None or who.id in blocked_ids_for(request.user):
            return Response({'error': 'No one by that name can be invited.', 'code': 'no_user'},
                            status=status.HTTP_400_BAD_REQUEST)
        m, created = M.objects.get_or_create(organization=org, user=who,
                                             defaults={'role': role, 'invited_by': request.user})
        if not created:
            if m.role == M.OWNER:
                return Response({'error': 'That is the owner.'}, status=status.HTTP_400_BAD_REQUEST)
            m.role = role
            m.save(update_fields=['role'])
        else:
            from ..push import notify_user
            notify_user(who, 'org_invite', f'{request.user.username} invited you to join {org.name}',
                        data={'type': 'org_invite', 'organization': org.slug})
        return Response(orgs.member_row(m), status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    @action(detail=True, methods=['patch', 'delete'], url_path=r'members/(?P<mid>\d+)',
            permission_classes=[permissions.IsAuthenticated])
    def member(self, request, slug=None, mid=None):
        org = self.get_object()
        m = org.members.filter(pk=mid).select_related('user').first()
        if m is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        mine = orgs.role_of(request.user, org)
        leaving = m.user_id == request.user.id and request.method == 'DELETE'
        if m.role == M.OWNER:
            return Response({'error': 'The owner stays; close the organisation instead.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if not leaving:
            if mine not in M.MANAGE_ROLES:
                raise PermissionDenied('Only those who run the organisation change who is in it.')
            if m.role == M.ADMIN and mine != M.OWNER:
                raise PermissionDenied('Only the owner changes an admin.')
        if request.method == 'DELETE':
            m.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        role = request.data.get('role')
        if role not in dict(M.ROLES) or role == M.OWNER or (role == M.ADMIN and mine != M.OWNER):
            return Response({'error': 'Unknown role.'}, status=status.HTTP_400_BAD_REQUEST)
        m.role = role
        m.save(update_fields=['role'])
        return Response(orgs.member_row(m))

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def respond(self, request, slug=None):
        org = self.get_object()
        m = M.objects.filter(organization=org, user=request.user, accepted_at__isnull=True).first()
        if m is None:
            return Response({'error': 'No invitation.'}, status=status.HTTP_404_NOT_FOUND)
        if str(request.data.get('accept', '')).lower() in ('1', 'true'):
            m.accepted_at = timezone.now()
            m.save(update_fields=['accepted_at'])
        else:
            m.delete()
        return Response(orgs.profile(org, request.user))

    @action(detail=False, methods=['get'], permission_classes=[permissions.IsAuthenticated])
    def invitations(self, request):
        rows = (M.objects.filter(user=request.user, accepted_at__isnull=True)
                .select_related('organization', 'invited_by').order_by('-created_at'))
        return Response({'results': [
            {'organization': orgs.mini(m.organization), 'role': m.role,
             'invited_by': m.invited_by.username if m.invited_by else ''} for m in rows]})
