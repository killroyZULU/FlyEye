import type { SupabaseClient } from '@supabase/supabase-js';

import {
  accessContextResponseSchema,
  type AccessContextResponse,
  type LoginRequest,
} from '../../../lib/access-context';
import type { Database } from '../../../lib/database.types';
import {
  memberDetailResultSchema,
  memberListSchema,
  memberProfileResultSchema,
  memberStatusResultSchema,
  type MemberDetail,
  type MemberList,
  type MemberProfile,
  type MemberStatus,
  type MemberStatusAction,
  type MemberStatusResult,
} from '../../members/member-administration';
import {
  adminOnboardingCompleteSchema,
  adminOnboardingStartSchema,
  adminOnboardingStatusSchema,
  type AdminBootstrapGrant,
  type AdminOnboardingComplete,
  type AdminOnboardingStart,
  type AdminOnboardingStatus,
  type TotpPreparation,
} from '../admin-onboarding';
import {
  invitationPreparationSchema,
  invitationMutationSchema,
  memberInvitationListSchema,
  type InvitationMutation,
  type MemberInvitationList,
} from '../member-invitations';
import { approvedRecoveryRedirect } from '../recovery';

export type AuthGatewayErrorCode =
  | 'invalid_credentials'
  | 'rate_limited'
  | 'network_error'
  | 'configuration_error'
  | 'access_context_conflict'
  | 'access_context_unavailable'
  | 'admin_onboarding_conflict'
  | 'admin_onboarding_not_available'
  | 'admin_onboarding_recent_authentication_required'
  | 'admin_onboarding_provider_unavailable'
  | 'admin_onboarding_audit_unavailable'
  | 'admin_onboarding_limiter_unavailable'
  | 'member_invitation_not_available'
  | 'member_invitation_conflict'
  | 'member_invitation_recent_authentication_required'
  | 'member_invitation_delivery_failed'
  | 'member_invitation_delivery_uncertain'
  | 'member_invitation_unavailable'
  | 'member_administration_not_found'
  | 'member_administration_validation_failed'
  | 'member_administration_state_conflict'
  | 'member_administration_last_administrator'
  | 'member_administration_self_action'
  | 'member_administration_recent_authentication_required'
  | 'member_administration_assurance_required'
  | 'member_administration_unavailable'
  | 'mfa_invalid'
  | 'mfa_enrollment_required'
  | 'recovery_invalid'
  | 'weak_password'
  | 'same_password'
  | 'password_update_failed'
  | 'revocation_failed'
  | 'unknown';

export class AuthGatewayError extends Error {
  constructor(
    public readonly code: AuthGatewayErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AuthGatewayError';
  }
}

export type MfaAssurance = {
  currentLevel: 'aal1' | 'aal2' | null;
  nextLevel: 'aal1' | 'aal2' | null;
};

export interface AuthGateway {
  hasSession(): Promise<boolean>;
  signIn(request: LoginRequest): Promise<void>;
  requestPasswordRecovery(email: string, captchaToken?: string): Promise<void>;
  verifyRecoveryCredential(tokenHash: string): Promise<void>;
  updateRecoveredPassword(password: string): Promise<void>;
  signOutEverywhere(): Promise<void>;
  loadAccessContext(): Promise<AccessContextResponse>;
  loadAdminOnboardingStatus(): Promise<AdminOnboardingStatus>;
  startAdminOnboarding(grant: AdminBootstrapGrant): Promise<AdminOnboardingStart>;
  prepareAdminTotp(factorState: AdminOnboardingStart['factorState']): Promise<TotpPreparation>;
  verifyAdminTotp(factorId: string, code: string): Promise<void>;
  completeAdminOnboarding(
    start: AdminOnboardingStart,
    idempotencyKey: string,
  ): Promise<AdminOnboardingComplete>;
  cancelAdminOnboarding(bootstrapGrantId: string, idempotencyKey: string): Promise<void>;
  loadMemberInvitations(organizationId: string): Promise<MemberInvitationList>;
  createMemberInvitation(request: {
    organizationId: string;
    email: string;
    roleCode: string;
    idempotencyKey: string;
  }): Promise<InvitationMutation>;
  resendMemberInvitation(request: {
    organizationId: string;
    invitationId: string;
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<InvitationMutation>;
  revokeMemberInvitation(request: {
    organizationId: string;
    invitationId: string;
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<InvitationMutation>;
  prepareInvitationCredential(
    password: string,
    invitation: { invitationId: string; expectedVersion: number },
  ): Promise<void>;
  acceptMemberInvitation(request: {
    invitationId: string;
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<InvitationMutation>;
  loadOrganizationMembers(request: {
    organizationId: string;
    status?: MemberStatus;
    search?: string;
    cursor?: string;
  }): Promise<MemberList>;
  loadOrganizationMember(organizationId: string, membershipId: string): Promise<MemberDetail>;
  loadMyMemberProfile(membershipId: string): Promise<MemberProfile>;
  updateMyMemberProfile(request: {
    membershipId: string;
    displayName: string;
    contactNumber: string;
    expectedVersion: number;
  }): Promise<MemberProfile>;
  changeOrganizationMemberStatus(request: {
    organizationId: string;
    membershipId: string;
    action: MemberStatusAction;
    reasonCode: string;
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<MemberStatusResult>;
  getMfaAssurance(): Promise<MfaAssurance>;
  verifyTotp(code: string): Promise<void>;
  signOut(): Promise<void>;
  onSignedOut(callback: () => void): () => void;
}

function responseStatus(error: unknown): number {
  if (typeof error !== 'object' || error === null) {
    return 0;
  }

  const context: unknown = Reflect.get(error, 'context');
  return context instanceof Response ? context.status : 0;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code: unknown = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : undefined;
}

function providerStatus(error: unknown): number {
  if (typeof error !== 'object' || error === null) return 0;
  const status: unknown = Reflect.get(error, 'status') as unknown;
  return typeof status === 'number' ? status : responseStatus(error);
}

function supportedAssuranceLevel(level: string | null): 'aal1' | 'aal2' | null {
  return level === 'aal1' || level === 'aal2' ? level : null;
}

const MAX_TOTP_QR_SVG_BYTES = 512 * 1024;
const MAX_TOTP_QR_SVG_ELEMENTS = 12_000;
const MAX_TOTP_QR_LEADING_COMMENTS = 4;
const MAX_TOTP_QR_COMMENT_BYTES = 512;
const MAX_TOTP_QR_COMMENTS_TOTAL_BYTES = 1024;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';
const SVG_ROOT_ATTRIBUTES = new Set(['height', 'width', 'xmlns', 'xmlns:xlink']);
const SVG_RECT_ATTRIBUTES = new Set(['height', 'style', 'width', 'x', 'y']);
const SVG_RECT_STYLE_PROPERTIES = new Set([
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-opacity',
  'stroke-width',
]);

function boundedSvgNumber(value: string, minimum: number): boolean {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?(?:px)?$/.test(value)) return false;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= 4096;
}

function safeSvgColor(value: string): boolean {
  if (/^(?:black|white|none|#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8})$/i.test(value)) {
    return true;
  }

  const rgb = /^rgb\(([^)]+)\)$/i.exec(value);
  if (!rgb?.[1]) return false;
  const components = rgb[1].split(',').map((component) => component.trim());
  if (components.length !== 3) return false;
  return components.every((component) => {
    const percentage = component.endsWith('%');
    const number = percentage ? component.slice(0, -1) : component;
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(number)) return false;
    const parsed = Number.parseFloat(number);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= (percentage ? 100 : 255);
  });
}

function safeSvgOpacity(value: string): boolean {
  if (!/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(value)) return false;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1;
}

function safeSvgRectStyle(value: string): boolean {
  if (value.length < 1 || value.length > 256) return false;
  const declarations = value
    .split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean);
  if (declarations.length < 1 || declarations.length > SVG_RECT_STYLE_PROPERTIES.size) {
    return false;
  }

  const properties = new Set<string>();
  for (const declaration of declarations) {
    const separator = declaration.indexOf(':');
    if (separator <= 0 || declaration.indexOf(':', separator + 1) !== -1) return false;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const propertyValue = declaration.slice(separator + 1).trim();
    if (!SVG_RECT_STYLE_PROPERTIES.has(property) || properties.has(property) || !propertyValue) {
      return false;
    }
    properties.add(property);

    if (
      ((property === 'fill' || property === 'stroke') && !safeSvgColor(propertyValue)) ||
      ((property === 'fill-opacity' || property === 'stroke-opacity') &&
        !safeSvgOpacity(propertyValue)) ||
      (property === 'stroke-width' && !boundedSvgNumber(propertyValue, 0))
    ) {
      return false;
    }
  }

  return properties.has('fill');
}

function safeSvgElementAttributes(element: Element, isRoot: boolean): boolean {
  const attributes = new Map(
    Array.from(element.attributes).map((attribute) => [
      attribute.name.toLowerCase(),
      attribute.value.trim(),
    ]),
  );
  const allowed = isRoot ? SVG_ROOT_ATTRIBUTES : SVG_RECT_ATTRIBUTES;
  if (
    attributes.size !== element.attributes.length ||
    [...attributes.keys()].some((name) => !allowed.has(name))
  ) {
    return false;
  }

  if (isRoot) {
    return (
      attributes.get('xmlns') === SVG_NAMESPACE &&
      (!attributes.has('xmlns:xlink') || attributes.get('xmlns:xlink') === XLINK_NAMESPACE) &&
      boundedSvgNumber(attributes.get('width') ?? '', 1) &&
      boundedSvgNumber(attributes.get('height') ?? '', 1)
    );
  }

  return (
    boundedSvgNumber(attributes.get('x') ?? '', 0) &&
    boundedSvgNumber(attributes.get('y') ?? '', 0) &&
    boundedSvgNumber(attributes.get('width') ?? '', 1) &&
    boundedSvgNumber(attributes.get('height') ?? '', 1) &&
    safeSvgRectStyle(attributes.get('style') ?? '')
  );
}

function normalizeTotpQrSvg(input: string): string | undefined {
  const providerValue = input.trim();
  const wrapper = /^data:image\/svg\+xml;utf-8,/i.exec(providerValue);
  if (!wrapper || new TextEncoder().encode(providerValue).byteLength > MAX_TOTP_QR_SVG_BYTES) {
    return undefined;
  }

  const svg = providerValue.slice(wrapper[0].length).trim();
  if (
    svg.length < 32 ||
    new TextEncoder().encode(svg).byteLength > MAX_TOTP_QR_SVG_BYTES ||
    Array.from(svg).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        codePoint !== 9 &&
        codePoint !== 10 &&
        codePoint !== 13 &&
        (codePoint < 32 || codePoint > 126)
      );
    }) ||
    /<!doctype|<!entity|<!\[cdata\[|<\?(?!xml\b)|<script\b|<foreignobject\b/i.test(svg)
  ) {
    return undefined;
  }

  let withoutDeclaration = svg;
  const declaration = /^<\?xml\s+([^?]+)\?>\s*/i.exec(svg);
  if (declaration) {
    const declarationText = declaration[1];
    if (!declarationText) return undefined;
    const declarationAttributes = [
      ...declarationText.matchAll(/([a-z]+)\s*=\s*(["'])([^"']+)\2/gi),
    ];
    if (
      declarationAttributes.some(
        (attribute) => !attribute[0] || !attribute[1] || attribute[3] === undefined,
      )
    ) {
      return undefined;
    }
    const residue = declarationAttributes.reduce(
      (value, attribute) => value.replace(attribute[0] ?? '', ''),
      declarationText,
    );
    const values = new Map(
      declarationAttributes.map((attribute) => [
        (attribute[1] ?? '').toLowerCase(),
        attribute[3] ?? '',
      ]),
    );
    if (
      residue.trim() ||
      values.size !== declarationAttributes.length ||
      values.get('version') !== '1.0' ||
      (values.has('encoding') && values.get('encoding')?.toUpperCase() !== 'UTF-8') ||
      (values.has('standalone') && values.get('standalone') !== 'no') ||
      [...values.keys()].some(
        (name) => name !== 'version' && name !== 'encoding' && name !== 'standalone',
      )
    ) {
      return undefined;
    }
    withoutDeclaration = svg.slice(declaration[0].length);
  }

  let normalizedSvg = withoutDeclaration;
  let commentCount = 0;
  let commentBytes = 0;
  while (normalizedSvg.startsWith('<!--')) {
    const comment = /^<!--([\s\S]*?)-->\s*/.exec(normalizedSvg);
    if (!comment?.[0] || comment[1] === undefined) return undefined;
    const currentCommentBytes = new TextEncoder().encode(comment[1]).byteLength;
    commentCount += 1;
    commentBytes += currentCommentBytes;
    if (
      commentCount > MAX_TOTP_QR_LEADING_COMMENTS ||
      currentCommentBytes > MAX_TOTP_QR_COMMENT_BYTES ||
      commentBytes > MAX_TOTP_QR_COMMENTS_TOTAL_BYTES ||
      comment[1].includes('--')
    ) {
      return undefined;
    }
    normalizedSvg = normalizedSvg.slice(comment[0].length);
  }

  if (!normalizedSvg.startsWith('<svg') || /<\?/.test(normalizedSvg)) {
    return undefined;
  }

  const document = new DOMParser().parseFromString(normalizedSvg, 'image/svg+xml');
  if (document.getElementsByTagName('parsererror').length !== 0) {
    return undefined;
  }

  const root = document.documentElement;
  const elements = Array.from(document.getElementsByTagName('*'));
  if (
    root.localName.toLowerCase() !== 'svg' ||
    root.namespaceURI !== SVG_NAMESPACE ||
    elements.length < 2 ||
    elements.length > MAX_TOTP_QR_SVG_ELEMENTS
  ) {
    return undefined;
  }

  for (const element of elements) {
    const isRoot = element === root;
    if (
      element.namespaceURI !== SVG_NAMESPACE ||
      (!isRoot && element.localName.toLowerCase() !== 'rect') ||
      (!isRoot && element.parentElement !== root) ||
      (!isRoot && element.childNodes.length !== 0) ||
      !safeSvgElementAttributes(element, isRoot)
    ) {
      return undefined;
    }
  }

  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === 1) continue;
    if (node.nodeType !== 3 || node.textContent?.trim()) return undefined;
  }

  return normalizedSvg;
}

async function edgeErrorDetails(
  error: unknown,
): Promise<{ status: number; code?: string; retryAfterSeconds?: number }> {
  const status = responseStatus(error);
  if (typeof error !== 'object' || error === null) return { status };
  const context: unknown = Reflect.get(error, 'context');
  if (!(context instanceof Response)) return { status };

  try {
    const payload: unknown = await context.clone().json();
    if (typeof payload !== 'object' || payload === null) return { status };
    const errorPayload: unknown = Reflect.get(payload, 'error');
    const code: unknown =
      typeof errorPayload === 'object' && errorPayload !== null
        ? (Reflect.get(errorPayload, 'code') as unknown)
        : undefined;
    const retryHeader = context.headers.get('retry-after');
    const retryAfterSeconds =
      retryHeader && /^\d+$/.test(retryHeader) ? Number.parseInt(retryHeader, 10) : undefined;
    return {
      status,
      code: typeof code === 'string' ? code : undefined,
      retryAfterSeconds,
    };
  } catch {
    return { status };
  }
}

function factorInventory(input: unknown): Array<{
  id: string;
  factor_type: 'totp' | 'phone' | 'webauthn';
  status: 'verified' | 'unverified';
}> {
  if (!Array.isArray(input) || input.length > 16) {
    throw new AuthGatewayError(
      'admin_onboarding_conflict',
      'Your authenticator information needs administrator review.',
    );
  }

  const factors = input.map((factor) => {
    if (typeof factor !== 'object' || factor === null) {
      throw new AuthGatewayError(
        'admin_onboarding_conflict',
        'Your authenticator information needs administrator review.',
      );
    }
    const id: unknown = Reflect.get(factor, 'id') as unknown;
    const factorType: unknown = Reflect.get(factor, 'factor_type') as unknown;
    const status: unknown = Reflect.get(factor, 'status') as unknown;
    if (
      typeof id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ||
      !['totp', 'phone', 'webauthn'].includes(String(factorType)) ||
      !['verified', 'unverified'].includes(String(status))
    ) {
      throw new AuthGatewayError(
        'admin_onboarding_conflict',
        'Your authenticator information needs administrator review.',
      );
    }
    return {
      id,
      factor_type: factorType as 'totp' | 'phone' | 'webauthn',
      status: status as 'verified' | 'unverified',
    };
  });

  if (new Set(factors.map((factor) => factor.id)).size !== factors.length) {
    throw new AuthGatewayError(
      'admin_onboarding_conflict',
      'Your authenticator information needs administrator review.',
    );
  }
  return factors;
}

function asGatewayError(error: unknown): AuthGatewayError {
  if (error instanceof AuthGatewayError) {
    return error;
  }

  if (providerStatus(error) === 429) {
    return new AuthGatewayError('rate_limited', 'Too many attempts. Wait before trying again.', {
      cause: error,
    });
  }

  if (error instanceof TypeError) {
    return new AuthGatewayError(
      'network_error',
      'FlyEye could not reach the authentication service.',
      {
        cause: error,
      },
    );
  }

  return new AuthGatewayError('unknown', 'FlyEye could not verify your access.', { cause: error });
}

export class SupabaseAuthGateway implements AuthGateway {
  constructor(
    private readonly client: SupabaseClient<Database>,
    private readonly recoveryOrigin = () => window.location.origin,
  ) {}

  async hasSession(): Promise<boolean> {
    const { data, error } = await this.client.auth.getSession();
    if (error) {
      throw asGatewayError(error);
    }

    return data.session !== null;
  }

  async signIn(request: LoginRequest): Promise<void> {
    const { error } = await this.client.auth.signInWithPassword(request);
    if (!error) {
      return;
    }

    if (error.status === 429) {
      throw new AuthGatewayError('rate_limited', 'Too many attempts. Wait before trying again.');
    }

    if (error.status === 400 || error.status === 401) {
      throw new AuthGatewayError(
        'invalid_credentials',
        'The email or password is incorrect, or access is unavailable.',
      );
    }

    throw asGatewayError(error);
  }

  async requestPasswordRecovery(email: string, captchaToken?: string): Promise<void> {
    let redirectTo: string;
    try {
      redirectTo = approvedRecoveryRedirect(this.recoveryOrigin());
    } catch (error) {
      throw new AuthGatewayError(
        'configuration_error',
        'Password recovery is not configured for this environment.',
        { cause: error },
      );
    }

    try {
      await this.client.auth.resetPasswordForEmail(email, {
        redirectTo,
        captchaToken,
      });
    } catch {
      // A syntactically valid public request always receives the same visible acknowledgement.
    }
  }

  async verifyRecoveryCredential(tokenHash: string): Promise<void> {
    try {
      const { error } = await this.client.auth.verifyOtp({
        token_hash: tokenHash,
        type: 'recovery',
      });
      if (!error) return;
      throw error;
    } catch (error) {
      if (error instanceof TypeError) {
        throw asGatewayError(error);
      }
      throw new AuthGatewayError(
        'recovery_invalid',
        'This recovery link cannot be used. Request a new one.',
        { cause: error },
      );
    }
  }

  async updateRecoveredPassword(password: string): Promise<void> {
    try {
      const { error } = await this.client.auth.updateUser({ password });
      if (!error) return;

      const code = errorCode(error);
      if (code === 'weak_password') {
        throw new AuthGatewayError(
          'weak_password',
          'Choose a stronger password that follows the guidance shown.',
          { cause: error },
        );
      }
      if (code === 'same_password') {
        throw new AuthGatewayError(
          'same_password',
          'Choose a password that is different from your current password.',
          { cause: error },
        );
      }
      throw error;
    } catch (error) {
      if (error instanceof AuthGatewayError) throw error;
      if (error instanceof TypeError) throw asGatewayError(error);
      throw new AuthGatewayError(
        'password_update_failed',
        'Your password could not be changed. Try again.',
        { cause: error },
      );
    }
  }

  async signOutEverywhere(): Promise<void> {
    let revocationError: unknown;
    try {
      const { error } = await this.client.auth.signOut({ scope: 'global' });
      if (!error) return;
      revocationError = error;
    } catch (error) {
      revocationError = error;
    }

    try {
      await this.client.auth.signOut({ scope: 'local' });
    } catch {
      // The recovery UI remains fail-closed even if local SDK cleanup also reports a failure.
    }

    throw new AuthGatewayError(
      'revocation_failed',
      'Your password changed, but session closure could not be confirmed. Sign in again or contact support.',
      { cause: revocationError },
    );
  }

  async loadAccessContext(): Promise<AccessContextResponse> {
    const invocation: unknown = await this.client.functions.invoke('auth-bootstrap', {
      body: {},
    });
    if (typeof invocation !== 'object' || invocation === null) {
      throw new AuthGatewayError(
        'access_context_unavailable',
        'Your access could not be verified. Try again.',
      );
    }

    const data: unknown = Reflect.get(invocation, 'data');
    const error: unknown = Reflect.get(invocation, 'error');

    if (error) {
      const status = responseStatus(error);
      if (status === 409) {
        throw new AuthGatewayError(
          'access_context_conflict',
          'Your access information needs administrator review.',
        );
      }

      throw new AuthGatewayError(
        'access_context_unavailable',
        'Your access could not be verified. Try again.',
      );
    }

    const parsed = accessContextResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new AuthGatewayError(
        'access_context_conflict',
        'Your access information needs administrator review.',
      );
    }

    return parsed.data;
  }

  private async invokeAdminOnboarding(body: Record<string, unknown>): Promise<unknown> {
    const invocation: unknown = await this.client.functions.invoke(
      'organization-admin-onboarding',
      { body },
    );
    if (typeof invocation !== 'object' || invocation === null) {
      throw new AuthGatewayError(
        'admin_onboarding_audit_unavailable',
        'Administrator onboarding could not be verified. Try again.',
      );
    }

    const data: unknown = Reflect.get(invocation, 'data');
    const error: unknown = Reflect.get(invocation, 'error');
    if (!error) return data;

    const details = await edgeErrorDetails(error);
    switch (details.code) {
      case 'admin_onboarding.rate_limited':
        throw new AuthGatewayError(
          'rate_limited',
          details.retryAfterSeconds
            ? `Wait ${details.retryAfterSeconds} seconds before trying again.`
            : 'Too many attempts. Wait before trying again.',
        );
      case 'admin_onboarding.recent_authentication_required':
        throw new AuthGatewayError(
          'admin_onboarding_recent_authentication_required',
          'Sign in with your password again to continue.',
        );
      case 'admin_onboarding.not_available':
      case 'admin_onboarding.not_eligible':
        throw new AuthGatewayError(
          'admin_onboarding_not_available',
          'This administrator onboarding request is not available.',
        );
      case 'admin_onboarding.conflict':
        throw new AuthGatewayError(
          'admin_onboarding_conflict',
          'Your administrator onboarding information needs review.',
        );
      case 'admin_onboarding.provider_unavailable':
        throw new AuthGatewayError(
          'admin_onboarding_provider_unavailable',
          'Authenticator state could not be confirmed. Try again.',
        );
      case 'admin_onboarding.limiter_unavailable':
        throw new AuthGatewayError(
          'admin_onboarding_limiter_unavailable',
          'Administrator onboarding is temporarily unavailable. Try again later.',
        );
      case 'admin_onboarding.audit_unavailable':
        throw new AuthGatewayError(
          'admin_onboarding_audit_unavailable',
          'Administrator onboarding could not be verified. Try again.',
        );
      default:
        if (details.status === 429) {
          throw new AuthGatewayError(
            'rate_limited',
            'Too many attempts. Wait before trying again.',
          );
        }
        throw new AuthGatewayError(
          'admin_onboarding_audit_unavailable',
          'Administrator onboarding could not be verified. Try again.',
        );
    }
  }

  async loadAdminOnboardingStatus(): Promise<AdminOnboardingStatus> {
    const parsed = adminOnboardingStatusSchema.safeParse(
      await this.invokeAdminOnboarding({ action: 'status' }),
    );
    if (!parsed.success) {
      throw new AuthGatewayError(
        'admin_onboarding_conflict',
        'Your administrator onboarding information needs review.',
      );
    }
    return parsed.data;
  }

  async startAdminOnboarding(grant: AdminBootstrapGrant): Promise<AdminOnboardingStart> {
    const parsed = adminOnboardingStartSchema.safeParse(
      await this.invokeAdminOnboarding({
        action: 'start',
        bootstrapGrantId: grant.bootstrapGrantId,
        expectedVersion: grant.grantVersion,
        idempotencyKey: crypto
          .getRandomValues(new Uint8Array(16))
          .reduce((value, byte) => `${value}${byte.toString(16).padStart(2, '0')}`, ''),
      }),
    );
    if (!parsed.success) {
      throw new AuthGatewayError(
        'admin_onboarding_conflict',
        'Your administrator onboarding information needs review.',
      );
    }
    return parsed.data;
  }

  async prepareAdminTotp(
    factorState: AdminOnboardingStart['factorState'],
  ): Promise<TotpPreparation> {
    const { data, error } = await this.client.auth.mfa.listFactors();
    if (error) throw asGatewayError(error);

    const all = factorInventory(data.all);
    const allTotpIds = all
      .filter((factor) => factor.factor_type === 'totp')
      .map((factor) => factor.id)
      .sort();
    const convenienceTotpIds = factorInventory(data.totp)
      .map((factor) => factor.id)
      .sort();
    if (
      allTotpIds.length !== convenienceTotpIds.length ||
      allTotpIds.some((id, index) => id !== convenienceTotpIds[index])
    ) {
      throw new AuthGatewayError(
        'admin_onboarding_conflict',
        'Your authenticator information needs administrator review.',
      );
    }

    if (factorState === 'challenge_required') {
      if (all.length !== 1 || all[0]?.factor_type !== 'totp' || all[0].status !== 'verified') {
        throw new AuthGatewayError(
          'admin_onboarding_conflict',
          'Your authenticator information needs administrator review.',
        );
      }
      return { kind: 'challenge', factorId: all[0].id };
    }

    if (all.length !== 0) {
      throw new AuthGatewayError(
        'admin_onboarding_conflict',
        'Your authenticator information needs administrator review.',
      );
    }

    const { data: enrollment, error: enrollmentError } = await this.client.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'FlyEye authenticator',
    });
    if (enrollmentError) throw asGatewayError(enrollmentError);

    const qrSvg = normalizeTotpQrSvg(enrollment.totp.qr_code);
    const manualSecret = enrollment.totp.secret;
    const uri = enrollment.totp.uri;
    if (
      !qrSvg ||
      !/^[A-Z2-7]+=*$/i.test(manualSecret) ||
      manualSecret.length < 16 ||
      manualSecret.length > 256 ||
      !uri.startsWith('otpauth://totp/') ||
      uri.length > 2048
    ) {
      throw new AuthGatewayError(
        'admin_onboarding_provider_unavailable',
        'Authenticator enrollment could not be prepared safely.',
      );
    }

    return {
      kind: 'enrollment',
      factorId: enrollment.id,
      qrSvg,
      manualSecret,
    };
  }

  async verifyAdminTotp(factorId: string, code: string): Promise<void> {
    const { error } = await this.client.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) {
      if (error.status === 429) {
        throw new AuthGatewayError('rate_limited', 'Too many attempts. Wait before trying again.');
      }
      throw new AuthGatewayError('mfa_invalid', 'The verification code is invalid or expired.');
    }

    const { data: assurance, error: assuranceError } =
      await this.client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError) throw asGatewayError(assuranceError);
    if (assurance.currentLevel !== 'aal2') {
      throw new AuthGatewayError(
        'admin_onboarding_provider_unavailable',
        'Authenticator verification could not be confirmed.',
      );
    }
  }

  async completeAdminOnboarding(
    start: AdminOnboardingStart,
    idempotencyKey: string,
  ): Promise<AdminOnboardingComplete> {
    const parsed = adminOnboardingCompleteSchema.safeParse(
      await this.invokeAdminOnboarding({
        action: 'complete',
        bootstrapGrantId: start.bootstrapGrantId,
        expectedVersion: start.grantVersion,
        idempotencyKey,
      }),
    );
    if (!parsed.success) {
      throw new AuthGatewayError(
        'admin_onboarding_conflict',
        'Administrator onboarding completion could not be revalidated.',
      );
    }
    return parsed.data;
  }

  async cancelAdminOnboarding(bootstrapGrantId: string, idempotencyKey: string): Promise<void> {
    try {
      await this.invokeAdminOnboarding({
        action: 'cancel',
        bootstrapGrantId,
        idempotencyKey,
      });
    } finally {
      try {
        await this.client.auth.signOut({ scope: 'local' });
      } catch {
        // The UI clears in-memory enrollment state even if local SDK cleanup reports failure.
      }
    }
  }

  private async invokeMemberInvitations(body: Record<string, unknown>): Promise<unknown> {
    const invocation: unknown = await this.client.functions.invoke('member-invitations', { body });
    if (typeof invocation !== 'object' || invocation === null) {
      throw new AuthGatewayError(
        'member_invitation_unavailable',
        'The invitation service is temporarily unavailable.',
      );
    }

    const data: unknown = Reflect.get(invocation, 'data');
    const error: unknown = Reflect.get(invocation, 'error');
    if (!error) return data;

    const details = await edgeErrorDetails(error);
    switch (details.code) {
      case 'member_invitation.rate_limited':
        throw new AuthGatewayError(
          'rate_limited',
          details.retryAfterSeconds
            ? `Wait ${details.retryAfterSeconds} seconds before trying again.`
            : 'Too many invitation attempts. Wait before trying again.',
        );
      case 'member_invitation.not_available':
        throw new AuthGatewayError(
          'member_invitation_not_available',
          'This invitation is not available.',
        );
      case 'member_invitation.conflict':
        throw new AuthGatewayError(
          'member_invitation_conflict',
          'The invitation state changed. Refresh and try again.',
        );
      case 'member_invitation.recent_authentication_required':
        throw new AuthGatewayError(
          'member_invitation_recent_authentication_required',
          'Sign in with your password again to continue.',
        );
      case 'member_invitation.delivery_failed':
        throw new AuthGatewayError(
          'member_invitation_delivery_failed',
          'The invitation could not be sent. It may be retried safely.',
        );
      case 'member_invitation.delivery_uncertain':
        throw new AuthGatewayError(
          'member_invitation_delivery_uncertain',
          'The delivery result could not be confirmed. Wait before retrying.',
        );
      default:
        throw new AuthGatewayError(
          'member_invitation_unavailable',
          'The invitation service is temporarily unavailable.',
        );
    }
  }

  async loadMemberInvitations(organizationId: string): Promise<MemberInvitationList> {
    const parsed = memberInvitationListSchema.safeParse(
      await this.invokeMemberInvitations({ action: 'list', organizationId }),
    );
    if (!parsed.success) {
      throw new AuthGatewayError(
        'member_invitation_conflict',
        'The invitation list could not be verified.',
      );
    }
    return parsed.data;
  }

  private async mutateMemberInvitation(body: Record<string, unknown>): Promise<InvitationMutation> {
    const parsed = invitationMutationSchema.safeParse(await this.invokeMemberInvitations(body));
    if (!parsed.success) {
      throw new AuthGatewayError(
        'member_invitation_conflict',
        'The invitation result could not be verified.',
      );
    }
    return parsed.data;
  }

  createMemberInvitation(request: {
    organizationId: string;
    email: string;
    roleCode: string;
    idempotencyKey: string;
  }): Promise<InvitationMutation> {
    return this.mutateMemberInvitation({ action: 'create', ...request });
  }

  resendMemberInvitation(request: {
    organizationId: string;
    invitationId: string;
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<InvitationMutation> {
    return this.mutateMemberInvitation({ action: 'resend', ...request });
  }

  revokeMemberInvitation(request: {
    organizationId: string;
    invitationId: string;
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<InvitationMutation> {
    return this.mutateMemberInvitation({ action: 'revoke', ...request });
  }

  async prepareInvitationCredential(
    password: string,
    invitation: { invitationId: string; expectedVersion: number },
  ): Promise<void> {
    const { data, error } = await this.client.auth.getUser();
    if (error || !data.user.email || !data.user.email_confirmed_at) {
      throw new AuthGatewayError(
        'member_invitation_not_available',
        'This invitation is not available for the signed-in account.',
      );
    }

    const preparation = invitationPreparationSchema.safeParse(
      await this.invokeMemberInvitations({ action: 'prepare', ...invitation }),
    );
    if (!preparation.success) {
      throw new AuthGatewayError(
        'member_invitation_not_available',
        'This invitation is not available for the signed-in account.',
      );
    }

    if (preparation.data.credentialMode === 'new') {
      const { error: updateError } = await this.client.auth.updateUser({ password });
      if (updateError) {
        if (errorCode(updateError) === 'weak_password') {
          throw new AuthGatewayError(
            'weak_password',
            'Choose a stronger password that follows the guidance shown.',
          );
        }
        throw asGatewayError(updateError);
      }
    }

    const { error: signInError } = await this.client.auth.signInWithPassword({
      email: data.user.email,
      password,
    });
    if (signInError) {
      throw new AuthGatewayError(
        'invalid_credentials',
        'The password is incorrect, or this invitation is unavailable.',
      );
    }
  }

  acceptMemberInvitation(request: {
    invitationId: string;
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<InvitationMutation> {
    return this.mutateMemberInvitation({ action: 'accept', ...request });
  }

  private async invokeMemberAdministration(body: Record<string, unknown>): Promise<unknown> {
    const invocation: unknown = await this.client.functions.invoke('member-administration', {
      body,
    });
    if (typeof invocation !== 'object' || invocation === null) {
      throw new AuthGatewayError(
        'member_administration_unavailable',
        'Member administration is temporarily unavailable.',
      );
    }

    const data: unknown = Reflect.get(invocation, 'data');
    const error: unknown = Reflect.get(invocation, 'error');
    if (!error) return data;

    const details = await edgeErrorDetails(error);
    switch (details.code) {
      case 'member_administration.rate_limited':
        throw new AuthGatewayError(
          'rate_limited',
          details.retryAfterSeconds
            ? `Wait ${details.retryAfterSeconds} seconds before trying again.`
            : 'Too many member requests. Wait before trying again.',
        );
      case 'member_administration.not_found':
        throw new AuthGatewayError(
          'member_administration_not_found',
          'The requested member information is not available.',
        );
      case 'member_administration.validation_failed':
      case 'member_administration.invalid_request':
        throw new AuthGatewayError(
          'member_administration_validation_failed',
          'The member request is invalid.',
        );
      case 'member_administration.state_conflict':
        throw new AuthGatewayError(
          'member_administration_state_conflict',
          'The member information changed. Refresh and try again.',
        );
      case 'member_administration.last_administrator':
        throw new AuthGatewayError(
          'member_administration_last_administrator',
          'At least one active Organization Admin must remain.',
        );
      case 'member_administration.self_action':
        throw new AuthGatewayError(
          'member_administration_self_action',
          'You cannot change your own membership status.',
        );
      case 'member_administration.recent_authentication_required':
        throw new AuthGatewayError(
          'member_administration_recent_authentication_required',
          'Sign in with your password again to continue.',
        );
      case 'member_administration.authentication_assurance_required':
        throw new AuthGatewayError(
          'member_administration_assurance_required',
          'Verify your authenticator to continue.',
        );
      default:
        throw new AuthGatewayError(
          'member_administration_unavailable',
          'Member administration is temporarily unavailable.',
        );
    }
  }

  async loadOrganizationMembers(request: {
    organizationId: string;
    status?: MemberStatus;
    search?: string;
    cursor?: string;
  }): Promise<MemberList> {
    const parsed = memberListSchema.safeParse(
      await this.invokeMemberAdministration({ action: 'list', ...request }),
    );
    if (!parsed.success) {
      throw new AuthGatewayError(
        'member_administration_state_conflict',
        'The member list could not be verified.',
      );
    }
    return parsed.data;
  }

  async loadOrganizationMember(
    organizationId: string,
    membershipId: string,
  ): Promise<MemberDetail> {
    const parsed = memberDetailResultSchema.safeParse(
      await this.invokeMemberAdministration({ action: 'detail', organizationId, membershipId }),
    );
    if (!parsed.success) {
      throw new AuthGatewayError(
        'member_administration_state_conflict',
        'The member detail could not be verified.',
      );
    }
    return parsed.data.member;
  }

  async loadMyMemberProfile(membershipId: string): Promise<MemberProfile> {
    const parsed = memberProfileResultSchema.safeParse(
      await this.invokeMemberAdministration({ action: 'get_profile', membershipId }),
    );
    if (!parsed.success) {
      throw new AuthGatewayError(
        'member_administration_state_conflict',
        'Your profile could not be verified.',
      );
    }
    return parsed.data.profile;
  }

  async updateMyMemberProfile(request: {
    membershipId: string;
    displayName: string;
    contactNumber: string;
    expectedVersion: number;
  }): Promise<MemberProfile> {
    const parsed = memberProfileResultSchema.safeParse(
      await this.invokeMemberAdministration({ action: 'update_profile', ...request }),
    );
    if (!parsed.success || parsed.data.decision !== 'updated') {
      throw new AuthGatewayError(
        'member_administration_state_conflict',
        'Your profile result could not be verified.',
      );
    }
    return parsed.data.profile;
  }

  async changeOrganizationMemberStatus(request: {
    organizationId: string;
    membershipId: string;
    action: MemberStatusAction;
    reasonCode: string;
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<MemberStatusResult> {
    const parsed = memberStatusResultSchema.safeParse(
      await this.invokeMemberAdministration(request),
    );
    if (!parsed.success) {
      throw new AuthGatewayError(
        'member_administration_state_conflict',
        'The membership result could not be verified.',
      );
    }
    return parsed.data;
  }

  async getMfaAssurance(): Promise<MfaAssurance> {
    const { data, error } = await this.client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) {
      throw asGatewayError(error);
    }

    return {
      currentLevel: supportedAssuranceLevel(data.currentLevel),
      nextLevel: supportedAssuranceLevel(data.nextLevel),
    };
  }

  async verifyTotp(code: string): Promise<void> {
    const { data: factorData, error: factorError } = await this.client.auth.mfa.listFactors();
    if (factorError) {
      throw asGatewayError(factorError);
    }

    const factor = factorData.totp.find((item) => item.status === 'verified');
    if (!factor) {
      throw new AuthGatewayError(
        'mfa_enrollment_required',
        'A verified authenticator is required. Contact your administrator.',
      );
    }

    const { error } = await this.client.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    if (error) {
      throw new AuthGatewayError('mfa_invalid', 'The verification code is invalid or expired.');
    }
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    if (error) {
      throw asGatewayError(error);
    }
  }

  onSignedOut(callback: () => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        callback();
      }
    });

    return () => data.subscription.unsubscribe();
  }
}
