// Helpers for gating the in-app admin panel. `currentUser` is the /profiles/me/
// payload (see useAuth), which carries admin_role / is_super_admin / capabilities.

export const isSuperAdmin = (user) =>
  !!user && (user.admin_role === 'super_admin' || user.is_super_admin === true);

// True if the user holds a specific capability (super admins hold all).
export const hasCapability = (user, cap) =>
  !!user && (isSuperAdmin(user) || (Array.isArray(user.capabilities) && user.capabilities.includes(cap)));

// Any staff member: super admin, a role with capabilities, or legacy is_staff.
export const isAdmin = (user) =>
  !!user && (
    isSuperAdmin(user) ||
    (Array.isArray(user.capabilities) && user.capabilities.length > 0) ||
    user.is_staff === true
  );
