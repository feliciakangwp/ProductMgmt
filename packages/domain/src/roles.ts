export const PROJECT_ROLES = ['admin', 'product_owner', 'business_analyst', 'developer', 'business_user'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  admin: 'Administrator',
  product_owner: 'Product Owner',
  business_analyst: 'Business Analyst',
  developer: 'Developer',
  business_user: 'Business User',
};

/**
 * Permission matrix for Phase 1. The database enforces the same rules in
 * RLS policies and RPC functions (see supabase/migrations); this copy only
 * drives what the UI offers.
 */
export const PERMISSIONS = {
  manageMembers: ['admin'],
  editProcess: ['admin', 'business_analyst'],
  runAnalysis: ['admin', 'business_analyst'],
  approveProcess: ['admin', 'product_owner'],
  editData: ['admin', 'business_analyst'],
  approveBusinessRule: ['admin', 'product_owner'],
} as const satisfies Record<string, readonly ProjectRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: ProjectRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly ProjectRole[]).includes(role);
}
