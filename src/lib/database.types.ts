export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      admin_onboarding_rate_limit_events: {
        Row: {
          action: string;
          correlation_id: string;
          id: string;
          limiter_key_hash: string;
          network_source_used: boolean;
          occurred_at: string;
          outcome: string;
          policy_version: string;
          retry_after_seconds: number | null;
          status_code: number;
        };
        Insert: {
          action: string;
          correlation_id: string;
          id?: string;
          limiter_key_hash: string;
          network_source_used?: boolean;
          occurred_at?: string;
          outcome: string;
          policy_version?: string;
          retry_after_seconds?: number | null;
          status_code: number;
        };
        Update: {
          action?: string;
          correlation_id?: string;
          id?: string;
          limiter_key_hash?: string;
          network_source_used?: boolean;
          occurred_at?: string;
          outcome?: string;
          policy_version?: string;
          retry_after_seconds?: number | null;
          status_code?: number;
        };
        Relationships: [];
      };
      admin_onboarding_rate_limit_state: {
        Row: {
          action: string;
          last_decision_at: string;
          last_refill_at: string;
          limiter_key_hash: string;
          tokens_milli: number;
        };
        Insert: {
          action: string;
          last_decision_at: string;
          last_refill_at: string;
          limiter_key_hash: string;
          tokens_milli: number;
        };
        Update: {
          action?: string;
          last_decision_at?: string;
          last_refill_at?: string;
          limiter_key_hash?: string;
          tokens_milli?: number;
        };
        Relationships: [];
      };
      authentication_events: {
        Row: {
          actor_kind: string;
          actor_subject_id: string | null;
          actor_user_id: string | null;
          correlation_id: string;
          event_name: string;
          id: string;
          idempotency_key_hash: string | null;
          metadata: Json;
          occurred_at: string;
          organization_id: string | null;
          organization_ids: string[];
          outcome: string;
          reason_code: string;
          source_code: string | null;
          source_instance_id: string | null;
          target_id: string | null;
          target_kind: string | null;
        };
        Insert: {
          actor_kind?: string;
          actor_subject_id?: string | null;
          actor_user_id?: string | null;
          correlation_id?: string;
          event_name: string;
          id?: string;
          idempotency_key_hash?: string | null;
          metadata?: Json;
          occurred_at?: string;
          organization_id?: string | null;
          organization_ids?: string[];
          outcome: string;
          reason_code: string;
          source_code?: string | null;
          source_instance_id?: string | null;
          target_id?: string | null;
          target_kind?: string | null;
        };
        Update: {
          actor_kind?: string;
          actor_subject_id?: string | null;
          actor_user_id?: string | null;
          correlation_id?: string;
          event_name?: string;
          id?: string;
          idempotency_key_hash?: string | null;
          metadata?: Json;
          occurred_at?: string;
          organization_id?: string | null;
          organization_ids?: string[];
          outcome?: string;
          reason_code?: string;
          source_code?: string | null;
          source_instance_id?: string | null;
          target_id?: string | null;
          target_kind?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'authentication_events_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      member_administration_events: {
        Row: {
          actor_user_id: string | null;
          correlation_id: string;
          event_name: string;
          id: string;
          idempotency_key_hash: string | null;
          metadata: Json;
          occurred_at: string;
          organization_id: string | null;
          outcome: string;
          reason_code: string;
          target_membership_id: string | null;
        };
        Insert: {
          actor_user_id?: string | null;
          correlation_id: string;
          event_name: string;
          id?: string;
          idempotency_key_hash?: string | null;
          metadata?: Json;
          occurred_at?: string;
          organization_id?: string | null;
          outcome: string;
          reason_code: string;
          target_membership_id?: string | null;
        };
        Update: {
          actor_user_id?: string | null;
          correlation_id?: string;
          event_name?: string;
          id?: string;
          idempotency_key_hash?: string | null;
          metadata?: Json;
          occurred_at?: string;
          organization_id?: string | null;
          outcome?: string;
          reason_code?: string;
          target_membership_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'member_administration_events_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'member_administration_events_organization_id_target_member_fkey';
            columns: ['organization_id', 'target_membership_id'];
            isOneToOne: false;
            referencedRelation: 'organization_memberships';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      member_administration_rate_limit_events: {
        Row: {
          action_group: string;
          correlation_id: string;
          id: string;
          limiter_key_hash: string;
          metadata: Json;
          occurred_at: string;
          outcome: string;
          retry_after_seconds: number | null;
        };
        Insert: {
          action_group: string;
          correlation_id: string;
          id?: string;
          limiter_key_hash: string;
          metadata?: Json;
          occurred_at?: string;
          outcome: string;
          retry_after_seconds?: number | null;
        };
        Update: {
          action_group?: string;
          correlation_id?: string;
          id?: string;
          limiter_key_hash?: string;
          metadata?: Json;
          occurred_at?: string;
          outcome?: string;
          retry_after_seconds?: number | null;
        };
        Relationships: [];
      };
      member_administration_rate_limit_state: {
        Row: {
          action_group: string;
          limiter_key_hash: string;
          tokens: number;
          updated_at: string;
        };
        Insert: {
          action_group: string;
          limiter_key_hash: string;
          tokens: number;
          updated_at: string;
        };
        Update: {
          action_group?: string;
          limiter_key_hash?: string;
          tokens?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      member_invitation_events: {
        Row: {
          actor_user_id: string | null;
          correlation_id: string;
          event_name: string;
          id: string;
          idempotency_key_hash: string | null;
          invitation_id: string | null;
          metadata: Json;
          occurred_at: string;
          organization_id: string | null;
          outcome: string;
          reason_code: string;
        };
        Insert: {
          actor_user_id?: string | null;
          correlation_id: string;
          event_name: string;
          id?: string;
          idempotency_key_hash?: string | null;
          invitation_id?: string | null;
          metadata?: Json;
          occurred_at?: string;
          organization_id?: string | null;
          outcome: string;
          reason_code: string;
        };
        Update: {
          actor_user_id?: string | null;
          correlation_id?: string;
          event_name?: string;
          id?: string;
          idempotency_key_hash?: string | null;
          invitation_id?: string | null;
          metadata?: Json;
          occurred_at?: string;
          organization_id?: string | null;
          outcome?: string;
          reason_code?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'member_invitation_events_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'member_invitation_events_organization_id_invitation_id_fkey';
            columns: ['organization_id', 'invitation_id'];
            isOneToOne: false;
            referencedRelation: 'organization_invitations';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      member_invitation_rate_limit_events: {
        Row: {
          action: string;
          correlation_id: string;
          id: string;
          limiter_key_hash: string;
          network_source_used: boolean;
          occurred_at: string;
          outcome: string;
          retry_after_seconds: number | null;
          status_code: number;
        };
        Insert: {
          action: string;
          correlation_id: string;
          id?: string;
          limiter_key_hash: string;
          network_source_used?: boolean;
          occurred_at?: string;
          outcome: string;
          retry_after_seconds?: number | null;
          status_code: number;
        };
        Update: {
          action?: string;
          correlation_id?: string;
          id?: string;
          limiter_key_hash?: string;
          network_source_used?: boolean;
          occurred_at?: string;
          outcome?: string;
          retry_after_seconds?: number | null;
          status_code?: number;
        };
        Relationships: [];
      };
      member_invitation_rate_limit_state: {
        Row: {
          action: string;
          last_decision_at: string;
          last_refill_at: string;
          limiter_key_hash: string;
          tokens_milli: number;
        };
        Insert: {
          action: string;
          last_decision_at: string;
          last_refill_at: string;
          limiter_key_hash: string;
          tokens_milli: number;
        };
        Update: {
          action?: string;
          last_decision_at?: string;
          last_refill_at?: string;
          limiter_key_hash?: string;
          tokens_milli?: number;
        };
        Relationships: [];
      };
      membership_roles: {
        Row: {
          assigned_at: string;
          assigned_by: string | null;
          membership_id: string;
          organization_id: string;
          role_id: string;
        };
        Insert: {
          assigned_at?: string;
          assigned_by?: string | null;
          membership_id: string;
          organization_id: string;
          role_id: string;
        };
        Update: {
          assigned_at?: string;
          assigned_by?: string | null;
          membership_id?: string;
          organization_id?: string;
          role_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'membership_roles_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'membership_roles_organization_id_membership_id_fkey';
            columns: ['organization_id', 'membership_id'];
            isOneToOne: true;
            referencedRelation: 'organization_memberships';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'membership_roles_role_id_fkey';
            columns: ['role_id'];
            isOneToOne: false;
            referencedRelation: 'roles';
            referencedColumns: ['id'];
          },
        ];
      };
      organization_admin_bootstrap_grants: {
        Row: {
          authorization_source_code: string;
          authorization_source_instance_id: string;
          authorization_source_kind: string;
          authorized_by_subject_id: string | null;
          completed_at: string | null;
          completed_membership_id: string | null;
          completion_idempotency_key_hash: string | null;
          created_at: string;
          eligible_user_id: string;
          expires_at: string;
          id: string;
          issuance_correlation_id: string;
          issued_at: string;
          organization_id: string;
          revoked_at: string | null;
          status: string;
          version: number;
        };
        Insert: {
          authorization_source_code: string;
          authorization_source_instance_id: string;
          authorization_source_kind: string;
          authorized_by_subject_id?: string | null;
          completed_at?: string | null;
          completed_membership_id?: string | null;
          completion_idempotency_key_hash?: string | null;
          created_at?: string;
          eligible_user_id: string;
          expires_at?: string;
          id?: string;
          issuance_correlation_id: string;
          issued_at?: string;
          organization_id: string;
          revoked_at?: string | null;
          status?: string;
          version?: number;
        };
        Update: {
          authorization_source_code?: string;
          authorization_source_instance_id?: string;
          authorization_source_kind?: string;
          authorized_by_subject_id?: string | null;
          completed_at?: string | null;
          completed_membership_id?: string | null;
          completion_idempotency_key_hash?: string | null;
          created_at?: string;
          eligible_user_id?: string;
          expires_at?: string;
          id?: string;
          issuance_correlation_id?: string;
          issued_at?: string;
          organization_id?: string;
          revoked_at?: string | null;
          status?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_admin_bootstrap__organization_id_completed_me_fkey';
            columns: ['organization_id', 'completed_membership_id'];
            isOneToOne: false;
            referencedRelation: 'organization_memberships';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'organization_admin_bootstrap_grants_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      organization_invitations: {
        Row: {
          acceptance_idempotency_key_hash: string | null;
          accepted_at: string | null;
          accepted_by: string | null;
          accepted_membership_id: string | null;
          correlation_id: string;
          created_at: string;
          delivery_attempt_count: number;
          delivery_operation_id: string | null;
          delivery_outcome: string | null;
          email_canonical: string;
          email_original: string;
          expired_at: string | null;
          expires_at: string;
          id: string;
          invited_by: string;
          issuance_action: string;
          issuance_idempotency_key_hash: string;
          issuance_source_version: number | null;
          issued_at: string;
          last_delivery_attempt_at: string | null;
          organization_id: string;
          provider_operation_class: string | null;
          revoked_at: string | null;
          role_id: string;
          status: string;
          superseded_at: string | null;
          supersedes_invitation_id: string | null;
          updated_at: string;
          version: number;
        };
        Insert: {
          acceptance_idempotency_key_hash?: string | null;
          accepted_at?: string | null;
          accepted_by?: string | null;
          accepted_membership_id?: string | null;
          correlation_id: string;
          created_at?: string;
          delivery_attempt_count?: number;
          delivery_operation_id?: string | null;
          delivery_outcome?: string | null;
          email_canonical: string;
          email_original: string;
          expired_at?: string | null;
          expires_at?: string;
          id?: string;
          invited_by: string;
          issuance_action?: string;
          issuance_idempotency_key_hash: string;
          issuance_source_version?: number | null;
          issued_at?: string;
          last_delivery_attempt_at?: string | null;
          organization_id: string;
          provider_operation_class?: string | null;
          revoked_at?: string | null;
          role_id: string;
          status?: string;
          superseded_at?: string | null;
          supersedes_invitation_id?: string | null;
          updated_at?: string;
          version?: number;
        };
        Update: {
          acceptance_idempotency_key_hash?: string | null;
          accepted_at?: string | null;
          accepted_by?: string | null;
          accepted_membership_id?: string | null;
          correlation_id?: string;
          created_at?: string;
          delivery_attempt_count?: number;
          delivery_operation_id?: string | null;
          delivery_outcome?: string | null;
          email_canonical?: string;
          email_original?: string;
          expired_at?: string | null;
          expires_at?: string;
          id?: string;
          invited_by?: string;
          issuance_action?: string;
          issuance_idempotency_key_hash?: string;
          issuance_source_version?: number | null;
          issued_at?: string;
          last_delivery_attempt_at?: string | null;
          organization_id?: string;
          provider_operation_class?: string | null;
          revoked_at?: string | null;
          role_id?: string;
          status?: string;
          superseded_at?: string | null;
          supersedes_invitation_id?: string | null;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_invitations_organization_id_accepted_membersh_fkey';
            columns: ['organization_id', 'accepted_membership_id'];
            isOneToOne: false;
            referencedRelation: 'organization_memberships';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'organization_invitations_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'organization_invitations_organization_id_supersedes_invita_fkey';
            columns: ['organization_id', 'supersedes_invitation_id'];
            isOneToOne: false;
            referencedRelation: 'organization_invitations';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'organization_invitations_role_id_fkey';
            columns: ['role_id'];
            isOneToOne: false;
            referencedRelation: 'roles';
            referencedColumns: ['id'];
          },
        ];
      };
      organization_member_profiles: {
        Row: {
          contact_number: string | null;
          created_at: string;
          created_by: string | null;
          display_name: string | null;
          id: string;
          membership_id: string;
          organization_id: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          contact_number?: string | null;
          created_at?: string;
          created_by?: string | null;
          display_name?: string | null;
          id?: string;
          membership_id: string;
          organization_id: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          contact_number?: string | null;
          created_at?: string;
          created_by?: string | null;
          display_name?: string | null;
          id?: string;
          membership_id?: string;
          organization_id?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_member_profiles_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'organization_member_profiles_organization_id_membership_id_fkey';
            columns: ['organization_id', 'membership_id'];
            isOneToOne: true;
            referencedRelation: 'organization_memberships';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      organization_memberships: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          organization_id: string;
          status: string;
          updated_at: string;
          updated_by: string | null;
          user_id: string;
          version: number;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          organization_id: string;
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
          user_id: string;
          version?: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          organization_id?: string;
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
          user_id?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_memberships_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      organizations: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
          status: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name: string;
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      permissions: {
        Row: {
          code: string;
          created_at: string;
          description: string;
          id: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          description?: string;
          id?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          description?: string;
          id?: string;
        };
        Relationships: [];
      };
      role_permissions: {
        Row: {
          created_at: string;
          permission_id: string;
          role_id: string;
        };
        Insert: {
          created_at?: string;
          permission_id: string;
          role_id: string;
        };
        Update: {
          created_at?: string;
          permission_id?: string;
          role_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'role_permissions_permission_id_fkey';
            columns: ['permission_id'];
            isOneToOne: false;
            referencedRelation: 'permissions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'role_permissions_role_id_fkey';
            columns: ['role_id'];
            isOneToOne: false;
            referencedRelation: 'roles';
            referencedColumns: ['id'];
          },
        ];
      };
      roles: {
        Row: {
          code: string;
          created_at: string;
          description: string;
          display_name: string;
          id: string;
          is_active: boolean;
          is_invitation_assignable: boolean;
        };
        Insert: {
          code: string;
          created_at?: string;
          description?: string;
          display_name: string;
          id?: string;
          is_active?: boolean;
          is_invitation_assignable?: boolean;
        };
        Update: {
          code?: string;
          created_at?: string;
          description?: string;
          display_name?: string;
          id?: string;
          is_active?: boolean;
          is_invitation_assignable?: boolean;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_member_invitation: {
        Args: {
          p_actor_user_id: string;
          p_confirmed_email: string;
          p_correlation_id: string;
          p_expected_version: number;
          p_idempotency_key_hash: string;
          p_invitation_id: string;
          p_password_authenticated_at: number;
        };
        Returns: Json;
      };
      begin_member_invitation: {
        Args: {
          p_actor_user_id: string;
          p_correlation_id: string;
          p_email: string;
          p_idempotency_key_hash: string;
          p_organization_id: string;
          p_role_code: string;
        };
        Returns: Json;
      };
      begin_resend_member_invitation: {
        Args: {
          p_actor_user_id: string;
          p_correlation_id: string;
          p_expected_version: number;
          p_idempotency_key_hash: string;
          p_invitation_id: string;
          p_organization_id: string;
        };
        Returns: Json;
      };
      cancel_organization_admin_onboarding: {
        Args: {
          p_actor_user_id: string;
          p_bootstrap_grant_id: string;
          p_correlation_id: string;
          p_idempotency_key_hash: string;
        };
        Returns: Json;
      };
      canonicalize_member_invitation_email: {
        Args: { p_email: string };
        Returns: string;
      };
      change_organization_member_status: {
        Args: {
          p_action: string;
          p_actor_user_id: string;
          p_correlation_id: string;
          p_expected_version: number;
          p_idempotency_key_hash: string;
          p_organization_id: string;
          p_reason_code: string;
          p_target_membership_id: string;
        };
        Returns: Json;
      };
      complete_first_organization_admin_bootstrap: {
        Args: {
          p_actor_subject_id: string;
          p_actor_user_id: string;
          p_assurance_level: string;
          p_authentication_methods: string[];
          p_bootstrap_grant_id: string;
          p_correlation_id: string;
          p_expected_version: number;
          p_idempotency_key_hash: string;
          p_password_authenticated_at: number;
          p_session_id: string;
          p_total_factor_count: number;
          p_verified_totp_factor_id: string;
        };
        Returns: Json;
      };
      consume_admin_onboarding_rate_limit: {
        Args: {
          p_action: string;
          p_correlation_id: string;
          p_limiter_key_hash: string;
        };
        Returns: Json;
      };
      consume_member_administration_rate_limit: {
        Args: {
          p_action: string;
          p_correlation_id: string;
          p_limiter_key_hash: string;
        };
        Returns: Json;
      };
      consume_member_invitation_rate_limit: {
        Args: {
          p_action: string;
          p_correlation_id: string;
          p_limiter_key_hash: string;
        };
        Returns: Json;
      };
      finalize_member_invitation_delivery: {
        Args: {
          p_actor_user_id: string;
          p_correlation_id: string;
          p_delivery_operation_id: string;
          p_delivery_outcome: string;
          p_invitation_id: string;
          p_provider_operation_class: string;
        };
        Returns: Json;
      };
      get_my_access_context: { Args: never; Returns: Json };
      get_my_member_profile: {
        Args: {
          p_actor_user_id: string;
          p_correlation_id: string;
          p_membership_id: string;
        };
        Returns: Json;
      };
      get_organization_admin_onboarding_status: {
        Args: { p_actor_user_id: string; p_correlation_id: string };
        Returns: Json;
      };
      get_organization_member: {
        Args: {
          p_actor_user_id: string;
          p_correlation_id: string;
          p_organization_id: string;
          p_target_membership_id: string;
        };
        Returns: Json;
      };
      list_member_invitations: {
        Args: {
          p_actor_user_id: string;
          p_correlation_id: string;
          p_organization_id: string;
        };
        Returns: Json;
      };
      list_organization_members: {
        Args: {
          p_actor_user_id: string;
          p_before_created_at?: string;
          p_before_membership_id?: string;
          p_correlation_id: string;
          p_limit?: number;
          p_organization_id: string;
          p_search?: string;
          p_status?: string;
        };
        Returns: Json;
      };
      materialize_member_invitation_expiry: {
        Args: {
          p_actor_user_id: string;
          p_correlation_id: string;
          p_invitation_id: string;
          p_organization_id: string;
        };
        Returns: number;
      };
      member_administration_actor_is_authorized: {
        Args: {
          p_actor_user_id: string;
          p_organization_id: string;
          p_permission_code: string;
        };
        Returns: boolean;
      };
      member_invitation_actor_is_authorized: {
        Args: { p_actor_user_id: string; p_organization_id: string };
        Returns: boolean;
      };
      prepare_member_invitation_acceptance: {
        Args: {
          p_actor_user_id: string;
          p_confirmed_email: string;
          p_correlation_id: string;
          p_expected_version: number;
          p_invitation_id: string;
        };
        Returns: Json;
      };
      record_authentication_access_decision: {
        Args: {
          p_actor_subject_id: string;
          p_actor_user_id: string;
          p_correlation_id: string;
          p_event_name: string;
          p_metadata?: Json;
          p_organization_id: string;
          p_organization_ids: string[];
          p_outcome: string;
          p_reason_code: string;
        };
        Returns: string;
      };
      record_member_administration_denial: {
        Args: {
          p_actor_user_id: string;
          p_correlation_id: string;
          p_event_name: string;
          p_organization_id?: string;
          p_reason_code: string;
          p_target_membership_id?: string;
        };
        Returns: string;
      };
      record_member_invitation_denial: {
        Args: {
          p_actor_user_id: string;
          p_correlation_id: string;
          p_event_name: string;
          p_invitation_id?: string;
          p_organization_id?: string;
          p_reason_code: string;
        };
        Returns: string;
      };
      required_member_profile_assurance: {
        Args: { p_actor_user_id: string; p_membership_id: string };
        Returns: string;
      };
      resolve_auth_access_context: {
        Args: {
          p_actor_user_id: string;
          p_assurance_level: string;
          p_selected_organization_id?: string;
        };
        Returns: Json;
      };
      resolve_member_administration_limiter_scope: {
        Args: {
          p_action: string;
          p_actor_user_id: string;
          p_membership_id?: string;
          p_organization_id?: string;
        };
        Returns: string;
      };
      resolve_member_invitation_limiter_scope: {
        Args: {
          p_action: string;
          p_actor_user_id: string;
          p_confirmed_email: string;
          p_invitation_id: string;
          p_organization_id: string;
        };
        Returns: string;
      };
      revoke_member_invitation: {
        Args: {
          p_actor_user_id: string;
          p_correlation_id: string;
          p_expected_version: number;
          p_idempotency_key_hash: string;
          p_invitation_id: string;
          p_organization_id: string;
        };
        Returns: Json;
      };
      start_organization_admin_onboarding: {
        Args: {
          p_actor_user_id: string;
          p_bootstrap_grant_id: string;
          p_correlation_id: string;
          p_expected_version: number;
          p_idempotency_key_hash: string;
        };
        Returns: Json;
      };
      update_my_member_profile: {
        Args: {
          p_actor_user_id: string;
          p_contact_number: string;
          p_correlation_id: string;
          p_display_name: string;
          p_expected_version: number;
          p_membership_id: string;
        };
        Returns: Json;
      };
      write_admin_onboarding_event: {
        Args: {
          p_actor_subject_id: string;
          p_actor_user_id: string;
          p_correlation_id: string;
          p_event_name: string;
          p_idempotency_key_hash?: string;
          p_metadata?: Json;
          p_organization_id: string;
          p_organization_ids: string[];
          p_outcome: string;
          p_reason_code: string;
          p_target_id: string;
        };
        Returns: string;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
