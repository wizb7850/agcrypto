// Rôles de l'équipe back-office et ce que chacun peut faire.
export const ROLES = ['owner', 'compliance', 'finance', 'support'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Propriétaire (tous les droits)',
  compliance: 'Conformité (vérifications, suspensions)',
  finance: 'Finance (retraits, revenus)',
  support: 'Support (lecture seule)',
};

const PERMISSIONS = {
  'overview:read': ['owner', 'compliance', 'finance', 'support'],
  'merchants:read': ['owner', 'compliance', 'finance', 'support'],
  'merchants:suspend': ['owner', 'compliance'],
  'kyc:read': ['owner', 'compliance'],
  'kyc:review': ['owner', 'compliance'],
  'withdrawals:read': ['owner', 'finance', 'support'],
  'withdrawals:process': ['owner', 'finance'],
  'revenue:read': ['owner', 'finance'],
  'audit:read': ['owner'],
  'team:manage': ['owner'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export const can = (role: string, permission: Permission) =>
  (PERMISSIONS[permission] as readonly string[]).includes(role);

export const permissionsOf = (role: string) =>
  (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p));
