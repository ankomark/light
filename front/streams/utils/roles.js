// Helpers for gating the in-app admin panel. `currentUser` is the /profiles/me/
// payload (see useAuth), which now carries admin_role / is_super_admin / is_staff.

export const isAdmin = (user) =>
  !!user && (
    user.admin_role === 'moderator' ||
    user.admin_role === 'super_admin' ||
    user.is_super_admin === true ||
    user.is_staff === true
  );

export const isSuperAdmin = (user) =>
  !!user && (user.admin_role === 'super_admin' || user.is_super_admin === true);
