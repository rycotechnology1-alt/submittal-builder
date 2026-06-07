// Client-safe types for admin user mutations. Mirror the server response
// shapes intentionally — keeping them here avoids dragging server-only
// modules into client bundles.

export type AdminUserListItem = {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  workspace: { id: string; name: string };
  emailVerified: boolean;
  requirePasswordChange: boolean;
  createdAt: string;
  lastSignInAt: string | null;
};

export type AdminCreateUserResponse = {
  user: { id: string; email: string; name: string; workspaceId: string };
  tempPassword: string;
};

export type AdminResetPasswordResponse = {
  tempPassword: string;
  sessionsRevoked: number;
};

export type AdminSendResetEmailResponse = {
  emailDelivery: 'sent' | 'queued_no_email';
};
