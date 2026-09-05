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
      aircraft_document_categories: {
        Row: {
          archived_at: string | null;
          archived_by: string | null;
          category_code: string;
          category_kind: string;
          category_label: string;
          category_state: string;
          created_at: string;
          created_by: string | null;
          id: string;
          organization_id: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          archived_at?: string | null;
          archived_by?: string | null;
          category_code: string;
          category_kind: string;
          category_label: string;
          category_state?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          organization_id: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          archived_at?: string | null;
          archived_by?: string | null;
          category_code?: string;
          category_kind?: string;
          category_label?: string;
          category_state?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          organization_id?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'aircraft_document_categories_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      aircraft_document_events: {
        Row: {
          actor_user_id: string | null;
          correlation_id: string;
          event_name: string;
          id: string;
          idempotency_key_hash: string | null;
          metadata: Json;
          occurred_at: string;
          organization_id: string;
          outcome: string;
          reason_code: string;
          target_id: string | null;
          target_type: string;
        };
        Insert: {
          actor_user_id?: string | null;
          correlation_id: string;
          event_name: string;
          id?: string;
          idempotency_key_hash?: string | null;
          metadata?: Json;
          occurred_at?: string;
          organization_id: string;
          outcome: string;
          reason_code: string;
          target_id?: string | null;
          target_type: string;
        };
        Update: {
          actor_user_id?: string | null;
          correlation_id?: string;
          event_name?: string;
          id?: string;
          idempotency_key_hash?: string | null;
          metadata?: Json;
          occurred_at?: string;
          organization_id?: string;
          outcome?: string;
          reason_code?: string;
          target_id?: string | null;
          target_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'aircraft_document_events_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      aircraft_document_idempotency: {
        Row: {
          action: string;
          actor_user_id: string;
          created_at: string;
          expected_version: number | null;
          idempotency_key_hash: string;
          organization_id: string;
          request_hash: string;
          result: Json;
          target_id: string | null;
        };
        Insert: {
          action: string;
          actor_user_id: string;
          created_at?: string;
          expected_version?: number | null;
          idempotency_key_hash: string;
          organization_id: string;
          request_hash: string;
          result: Json;
          target_id?: string | null;
        };
        Update: {
          action?: string;
          actor_user_id?: string;
          created_at?: string;
          expected_version?: number | null;
          idempotency_key_hash?: string;
          organization_id?: string;
          request_hash?: string;
          result?: Json;
          target_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'aircraft_document_idempotency_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      aircraft_document_notifications: {
        Row: {
          aircraft_document_id: string;
          created_at: string;
          document_version_id: string;
          due_date: string;
          event_kind: string;
          id: string;
          notification_state: string;
          organization_id: string;
          read_at: string | null;
          recipient_membership_id: string;
          resolution_reason: string | null;
          resolved_at: string | null;
        };
        Insert: {
          aircraft_document_id: string;
          created_at?: string;
          document_version_id: string;
          due_date: string;
          event_kind: string;
          id?: string;
          notification_state?: string;
          organization_id: string;
          read_at?: string | null;
          recipient_membership_id: string;
          resolution_reason?: string | null;
          resolved_at?: string | null;
        };
        Update: {
          aircraft_document_id?: string;
          created_at?: string;
          document_version_id?: string;
          due_date?: string;
          event_kind?: string;
          id?: string;
          notification_state?: string;
          organization_id?: string;
          read_at?: string | null;
          recipient_membership_id?: string;
          resolution_reason?: string | null;
          resolved_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'aircraft_document_notificatio_organization_id_aircraft_doc_fkey';
            columns: ['organization_id', 'aircraft_document_id'];
            isOneToOne: false;
            referencedRelation: 'aircraft_documents';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'aircraft_document_notificatio_organization_id_document_ver_fkey';
            columns: ['organization_id', 'document_version_id'];
            isOneToOne: false;
            referencedRelation: 'aircraft_document_versions';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'aircraft_document_notificatio_organization_id_recipient_me_fkey';
            columns: ['organization_id', 'recipient_membership_id'];
            isOneToOne: false;
            referencedRelation: 'organization_memberships';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'aircraft_document_notifications_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      aircraft_document_rate_limit_events: {
        Row: {
          bucket: string;
          correlation_id: string;
          id: string;
          limiter_key_hash: string;
          occurred_at: string;
          outcome: string;
          retry_after_seconds: number | null;
        };
        Insert: {
          bucket: string;
          correlation_id: string;
          id?: string;
          limiter_key_hash: string;
          occurred_at?: string;
          outcome: string;
          retry_after_seconds?: number | null;
        };
        Update: {
          bucket?: string;
          correlation_id?: string;
          id?: string;
          limiter_key_hash?: string;
          occurred_at?: string;
          outcome?: string;
          retry_after_seconds?: number | null;
        };
        Relationships: [];
      };
      aircraft_document_rate_limit_state: {
        Row: {
          bucket: string;
          limiter_key_hash: string;
          tokens: number;
          updated_at: string;
        };
        Insert: {
          bucket: string;
          limiter_key_hash: string;
          tokens: number;
          updated_at: string;
        };
        Update: {
          bucket?: string;
          limiter_key_hash?: string;
          tokens?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      aircraft_document_requirements: {
        Row: {
          aircraft_record_id: string;
          archived_at: string | null;
          archived_by: string | null;
          category_id: string;
          created_at: string;
          created_by: string;
          id: string;
          organization_id: string;
          requirement_state: string;
          updated_at: string;
          updated_by: string;
          version: number;
        };
        Insert: {
          aircraft_record_id: string;
          archived_at?: string | null;
          archived_by?: string | null;
          category_id: string;
          created_at?: string;
          created_by: string;
          id?: string;
          organization_id: string;
          requirement_state?: string;
          updated_at?: string;
          updated_by: string;
          version?: number;
        };
        Update: {
          aircraft_record_id?: string;
          archived_at?: string | null;
          archived_by?: string | null;
          category_id?: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          organization_id?: string;
          requirement_state?: string;
          updated_at?: string;
          updated_by?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'aircraft_document_requirement_organization_id_aircraft_rec_fkey';
            columns: ['organization_id', 'aircraft_record_id'];
            isOneToOne: false;
            referencedRelation: 'aircraft_records';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'aircraft_document_requirements_organization_id_category_id_fkey';
            columns: ['organization_id', 'category_id'];
            isOneToOne: false;
            referencedRelation: 'aircraft_document_categories';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'aircraft_document_requirements_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      aircraft_document_versions: {
        Row: {
          aircraft_document_id: string;
          category_code: string;
          category_label: string;
          created_at: string;
          created_by: string;
          document_source: string;
          document_title: string;
          expiration_date: string;
          id: string;
          issue_date: string | null;
          notes: string | null;
          organization_id: string;
          reference_number: string | null;
          stored_file_id: string | null;
          version_kind: string;
          version_number: number;
          version_reason: string | null;
        };
        Insert: {
          aircraft_document_id: string;
          category_code: string;
          category_label: string;
          created_at?: string;
          created_by: string;
          document_source: string;
          document_title: string;
          expiration_date: string;
          id?: string;
          issue_date?: string | null;
          notes?: string | null;
          organization_id: string;
          reference_number?: string | null;
          stored_file_id?: string | null;
          version_kind: string;
          version_number: number;
          version_reason?: string | null;
        };
        Update: {
          aircraft_document_id?: string;
          category_code?: string;
          category_label?: string;
          created_at?: string;
          created_by?: string;
          document_source?: string;
          document_title?: string;
          expiration_date?: string;
          id?: string;
          issue_date?: string | null;
          notes?: string | null;
          organization_id?: string;
          reference_number?: string | null;
          stored_file_id?: string | null;
          version_kind?: string;
          version_number?: number;
          version_reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'aircraft_document_versions_organization_id_aircraft_docume_fkey';
            columns: ['organization_id', 'aircraft_document_id'];
            isOneToOne: false;
            referencedRelation: 'aircraft_documents';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'aircraft_document_versions_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'aircraft_document_versions_organization_id_stored_file_id_fkey';
            columns: ['organization_id', 'stored_file_id'];
            isOneToOne: false;
            referencedRelation: 'stored_files';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      aircraft_documents: {
        Row: {
          aircraft_record_id: string;
          archived_at: string | null;
          archived_by: string | null;
          category_id: string;
          created_at: string;
          created_by: string;
          current_version_id: string | null;
          document_state: string;
          id: string;
          organization_id: string;
          suspended_at: string | null;
          suspended_by: string | null;
          suspension_reason: string | null;
          updated_at: string;
          updated_by: string;
          version: number;
        };
        Insert: {
          aircraft_record_id: string;
          archived_at?: string | null;
          archived_by?: string | null;
          category_id: string;
          created_at?: string;
          created_by: string;
          current_version_id?: string | null;
          document_state?: string;
          id?: string;
          organization_id: string;
          suspended_at?: string | null;
          suspended_by?: string | null;
          suspension_reason?: string | null;
          updated_at?: string;
          updated_by: string;
          version?: number;
        };
        Update: {
          aircraft_record_id?: string;
          archived_at?: string | null;
          archived_by?: string | null;
          category_id?: string;
          created_at?: string;
          created_by?: string;
          current_version_id?: string | null;
          document_state?: string;
          id?: string;
          organization_id?: string;
          suspended_at?: string | null;
          suspended_by?: string | null;
          suspension_reason?: string | null;
          updated_at?: string;
          updated_by?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'aircraft_documents_current_version_fk';
            columns: ['organization_id', 'current_version_id'];
            isOneToOne: false;
            referencedRelation: 'aircraft_document_versions';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'aircraft_documents_organization_id_aircraft_record_id_fkey';
            columns: ['organization_id', 'aircraft_record_id'];
            isOneToOne: false;
            referencedRelation: 'aircraft_records';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'aircraft_documents_organization_id_category_id_fkey';
            columns: ['organization_id', 'category_id'];
            isOneToOne: false;
            referencedRelation: 'aircraft_document_categories';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'aircraft_documents_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      aircraft_records: {
        Row: {
          archive_reason: string | null;
          archived_at: string | null;
          archived_by: string | null;
          created_at: string;
          created_by: string;
          id: string;
          manufacturer: string;
          model: string;
          organization_id: string;
          registration_key: string;
          registration_mark: string;
          registry_state: string;
          updated_at: string;
          updated_by: string;
          version: number;
        };
        Insert: {
          archive_reason?: string | null;
          archived_at?: string | null;
          archived_by?: string | null;
          created_at?: string;
          created_by: string;
          id?: string;
          manufacturer: string;
          model: string;
          organization_id: string;
          registration_key: string;
          registration_mark: string;
          registry_state?: string;
          updated_at?: string;
          updated_by: string;
          version?: number;
        };
        Update: {
          archive_reason?: string | null;
          archived_at?: string | null;
          archived_by?: string | null;
          created_at?: string;
          created_by?: string;
          id?: string;
          manufacturer?: string;
          model?: string;
          organization_id?: string;
          registration_key?: string;
          registration_mark?: string;
          registry_state?: string;
          updated_at?: string;
          updated_by?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'aircraft_records_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      aircraft_registry_events: {
        Row: {
          actor_user_id: string | null;
          correlation_id: string;
          event_name: string;
          id: string;
          idempotency_key_hash: string | null;
          metadata: Json;
          occurred_at: string;
          organization_id: string;
          outcome: string;
          reason_code: string;
          target_record_id: string | null;
        };
        Insert: {
          actor_user_id?: string | null;
          correlation_id: string;
          event_name: string;
          id?: string;
          idempotency_key_hash?: string | null;
          metadata?: Json;
          occurred_at?: string;
          organization_id: string;
          outcome: string;
          reason_code: string;
          target_record_id?: string | null;
        };
        Update: {
          actor_user_id?: string | null;
          correlation_id?: string;
          event_name?: string;
          id?: string;
          idempotency_key_hash?: string | null;
          metadata?: Json;
          occurred_at?: string;
          organization_id?: string;
          outcome?: string;
          reason_code?: string;
          target_record_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'aircraft_registry_events_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'aircraft_registry_events_organization_id_target_record_id_fkey';
            columns: ['organization_id', 'target_record_id'];
            isOneToOne: false;
            referencedRelation: 'aircraft_records';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      aircraft_registry_idempotency: {
        Row: {
          action: string;
          actor_user_id: string;
          created_at: string;
          expected_version: number | null;
          idempotency_key_hash: string;
          organization_id: string;
          request_hash: string;
          result: Json;
          target_record_id: string | null;
        };
        Insert: {
          action: string;
          actor_user_id: string;
          created_at?: string;
          expected_version?: number | null;
          idempotency_key_hash: string;
          organization_id: string;
          request_hash: string;
          result: Json;
          target_record_id?: string | null;
        };
        Update: {
          action?: string;
          actor_user_id?: string;
          created_at?: string;
          expected_version?: number | null;
          idempotency_key_hash?: string;
          organization_id?: string;
          request_hash?: string;
          result?: Json;
          target_record_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'aircraft_registry_idempotency_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'aircraft_registry_idempotency_organization_id_target_recor_fkey';
            columns: ['organization_id', 'target_record_id'];
            isOneToOne: false;
            referencedRelation: 'aircraft_records';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
      };
      aircraft_registry_rate_limit_events: {
        Row: {
          bucket: string;
          correlation_id: string;
          id: string;
          limiter_key_hash: string;
          occurred_at: string;
          outcome: string;
          retry_after_seconds: number | null;
        };
        Insert: {
          bucket: string;
          correlation_id: string;
          id?: string;
          limiter_key_hash: string;
          occurred_at?: string;
          outcome: string;
          retry_after_seconds?: number | null;
        };
        Update: {
          bucket?: string;
          correlation_id?: string;
          id?: string;
          limiter_key_hash?: string;
          occurred_at?: string;
          outcome?: string;
          retry_after_seconds?: number | null;
        };
        Relationships: [];
      };
      aircraft_registry_rate_limit_state: {
        Row: {
          bucket: string;
          limiter_key_hash: string;
          tokens: number;
          updated_at: string;
        };
        Insert: {
          bucket: string;
          limiter_key_hash: string;
          tokens: number;
          updated_at: string;
        };
        Update: {
          bucket?: string;
          limiter_key_hash?: string;
          tokens?: number;
          updated_at?: string;
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
      member_mfa_enrollment_operations: {
        Row: {
          bind_idempotency_key_hash: string | null;
          cancel_idempotency_key_hash: string | null;
          cancelled_at: string | null;
          complete_idempotency_key_hash: string | null;
          completed_at: string | null;
          created_at: string;
          expires_at: string;
          factor_reference_hash: string | null;
          id: string;
          membership_id: string;
          organization_id: string;
          start_idempotency_key_hash: string;
          status: string;
          subject_user_id: string;
          version: number;
        };
        Insert: {
          bind_idempotency_key_hash?: string | null;
          cancel_idempotency_key_hash?: string | null;
          cancelled_at?: string | null;
          complete_idempotency_key_hash?: string | null;
          completed_at?: string | null;
          created_at?: string;
          expires_at?: string;
          factor_reference_hash?: string | null;
          id?: string;
          membership_id: string;
          organization_id: string;
          start_idempotency_key_hash: string;
          status: string;
          subject_user_id: string;
          version?: number;
        };
        Update: {
          bind_idempotency_key_hash?: string | null;
          cancel_idempotency_key_hash?: string | null;
          cancelled_at?: string | null;
          complete_idempotency_key_hash?: string | null;
          completed_at?: string | null;
          created_at?: string;
          expires_at?: string;
          factor_reference_hash?: string | null;
          id?: string;
          membership_id?: string;
          organization_id?: string;
          start_idempotency_key_hash?: string;
          status?: string;
          subject_user_id?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'member_mfa_enrollment_operati_organization_id_membership_i_fkey';
            columns: ['organization_id', 'membership_id'];
            isOneToOne: false;
            referencedRelation: 'organization_memberships';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'member_mfa_enrollment_operations_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      member_mfa_rate_limit_events: {
        Row: {
          action: string;
          correlation_id: string;
          id: string;
          limiter_key_hash: string;
          occurred_at: string;
          outcome: string;
          retry_after_seconds: number | null;
        };
        Insert: {
          action: string;
          correlation_id: string;
          id?: string;
          limiter_key_hash: string;
          occurred_at?: string;
          outcome: string;
          retry_after_seconds?: number | null;
        };
        Update: {
          action?: string;
          correlation_id?: string;
          id?: string;
          limiter_key_hash?: string;
          occurred_at?: string;
          outcome?: string;
          retry_after_seconds?: number | null;
        };
        Relationships: [];
      };
      member_mfa_rate_limit_state: {
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
      member_mfa_readiness: {
        Row: {
          factor_reference_hash: string;
          membership_id: string;
          organization_id: string;
          subject_user_id: string;
          updated_at: string;
          verified_at: string;
          version: number;
        };
        Insert: {
          factor_reference_hash: string;
          membership_id: string;
          organization_id: string;
          subject_user_id: string;
          updated_at?: string;
          verified_at: string;
          version?: number;
        };
        Update: {
          factor_reference_hash?: string;
          membership_id?: string;
          organization_id?: string;
          subject_user_id?: string;
          updated_at?: string;
          verified_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'member_mfa_readiness_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'member_mfa_readiness_organization_id_membership_id_fkey';
            columns: ['organization_id', 'membership_id'];
            isOneToOne: true;
            referencedRelation: 'organization_memberships';
            referencedColumns: ['organization_id', 'id'];
          },
        ];
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
          deployment_slot: number;
          id: string;
          name: string;
          status: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          deployment_slot?: number;
          id?: string;
          name: string;
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          deployment_slot?: number;
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
          is_membership_assignable: boolean;
          required_assurance_level: string;
          workspace_permission_code: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          description?: string;
          display_name: string;
          id?: string;
          is_active?: boolean;
          is_invitation_assignable?: boolean;
          is_membership_assignable?: boolean;
          required_assurance_level?: string;
          workspace_permission_code: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          description?: string;
          display_name?: string;
          id?: string;
          is_active?: boolean;
          is_invitation_assignable?: boolean;
          is_membership_assignable?: boolean;
          required_assurance_level?: string;
          workspace_permission_code?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'roles_workspace_permission_code_fkey';
            columns: ['workspace_permission_code'];
            isOneToOne: false;
            referencedRelation: 'permissions';
            referencedColumns: ['code'];
          },
        ];
      };
      stored_files: {
        Row: {
          aircraft_record_id: string;
          bucket_id: string;
          classification: string;
          created_at: string;
          display_name: string;
          generated_name: string;
          id: string;
          media_type: string;
          object_key: string;
          organization_id: string;
          scan_state: string;
          sha256_hash: string;
          size_bytes: number;
          updated_at: string;
          uploader_user_id: string;
        };
        Insert: {
          aircraft_record_id: string;
          bucket_id?: string;
          classification?: string;
          created_at?: string;
          display_name: string;
          generated_name: string;
          id?: string;
          media_type: string;
          object_key: string;
          organization_id: string;
          scan_state: string;
          sha256_hash: string;
          size_bytes: number;
          updated_at?: string;
          uploader_user_id: string;
        };
        Update: {
          aircraft_record_id?: string;
          bucket_id?: string;
          classification?: string;
          created_at?: string;
          display_name?: string;
          generated_name?: string;
          id?: string;
          media_type?: string;
          object_key?: string;
          organization_id?: string;
          scan_state?: string;
          sha256_hash?: string;
          size_bytes?: number;
          updated_at?: string;
          uploader_user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'stored_files_organization_id_aircraft_record_id_fkey';
            columns: ['organization_id', 'aircraft_record_id'];
            isOneToOne: false;
            referencedRelation: 'aircraft_records';
            referencedColumns: ['organization_id', 'id'];
          },
          {
            foreignKeyName: 'stored_files_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
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
      aircraft_document_actor_is_authorized: {
        Args: {
          p_actor_user_id: string;
          p_organization_id: string;
          p_permission_code: string;
        };
        Returns: boolean;
      };
      aircraft_record_summary: {
        Args: {
          p_record: Database['public']['Tables']['aircraft_records']['Row'];
        };
        Returns: Json;
      };
      aircraft_registry_actor_is_authorized: {
        Args: {
          p_actor_user_id: string;
          p_organization_id: string;
          p_permission_code: string;
        };
        Returns: boolean;
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
      bind_member_mfa_factor: {
        Args: {
          p_actor_user_id: string;
          p_correlation_id: string;
          p_expected_version: number;
          p_factor_reference_hash: string;
          p_idempotency_key_hash: string;
          p_operation_id: string;
        };
        Returns: Json;
      };
      calculate_aircraft_document_status: {
        Args: {
          p_document_state: string;
          p_expiration_date: string;
          p_is_archived: boolean;
          p_philippine_date: string;
        };
        Returns: string;
      };
      cancel_member_mfa_enrollment: {
        Args: {
          p_actor_user_id: string;
          p_cleanup_outcome: string;
          p_correlation_id: string;
          p_expected_version: number;
          p_factor_reference_hash: string;
          p_idempotency_key_hash: string;
          p_operation_id: string;
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
      change_organization_member_role: {
        Args: {
          p_actor_user_id: string;
          p_correlation_id: string;
          p_expected_version: number;
          p_factor_reference_hash: string;
          p_idempotency_key_hash: string;
          p_new_role_code: string;
          p_organization_id: string;
          p_reason_code: string;
          p_target_membership_id: string;
        };
        Returns: Json;
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
      complete_aircraft_document_file: {
        Args: {
          p_actor_user_id: string;
          p_correlation_id: string;
          p_file_id: string;
          p_organization_id: string;
          p_scan_state: string;
          p_verified_sha256_hash: string;
          p_verified_size_bytes: number;
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
      complete_member_mfa_enrollment: {
        Args: {
          p_actor_user_id: string;
          p_assurance_level: string;
          p_authentication_methods: string[];
          p_correlation_id: string;
          p_expected_version: number;
          p_factor_reference_hash: string;
          p_idempotency_key_hash: string;
          p_operation_id: string;
          p_password_authenticated_at: number;
          p_session_id: string;
        };
        Returns: Json;
      };
      confirm_aircraft_document_download_issued: {
        Args: {
          p_actor_user_id: string;
          p_correlation_id: string;
          p_file_id: string;
          p_organization_id: string;
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
      consume_aircraft_document_rate_limit: {
        Args: {
          p_bucket: string;
          p_correlation_id: string;
          p_limiter_key_hash: string;
        };
        Returns: Json;
      };
      consume_aircraft_registry_rate_limit: {
        Args: {
          p_bucket: string;
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
      consume_member_mfa_rate_limit: {
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
      get_aircraft_document_detail: {
        Args: {
          p_actor_user_id: string;
          p_correlation_id: string;
          p_document_id: string;
          p_organization_id: string;
          p_philippine_date: string;
        };
        Returns: Json;
      };
      get_aircraft_document_download_target: {
        Args: {
          p_actor_user_id: string;
          p_correlation_id: string;
          p_file_id: string;
          p_organization_id: string;
        };
        Returns: Json;
      };
      get_aircraft_document_staged_file: {
        Args: {
          p_actor_user_id: string;
          p_file_id: string;
          p_organization_id: string;
        };
        Returns: Json;
      };
      get_aircraft_record: {
        Args: {
          p_actor_user_id: string;
          p_correlation_id: string;
          p_organization_id: string;
          p_record_id: string;
        };
        Returns: Json;
      };
      get_member_mfa_status: {
        Args: {
          p_actor_user_id: string;
          p_correlation_id: string;
          p_factor_reference_hash: string;
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
      list_aircraft_document_history: {
        Args: {
          p_actor_user_id: string;
          p_correlation_id: string;
          p_document_id: string;
          p_organization_id: string;
          p_page: number;
          p_page_size: number;
        };
        Returns: Json;
      };
      list_aircraft_document_notifications: {
        Args: {
          p_actor_user_id: string;
          p_correlation_id: string;
          p_include_resolved: boolean;
          p_membership_id: string;
          p_organization_id: string;
          p_page: number;
          p_page_size: number;
        };
        Returns: Json;
      };
      list_aircraft_document_status: {
        Args: {
          p_actor_user_id: string;
          p_aircraft_record_id: string;
          p_correlation_id: string;
          p_organization_id: string;
          p_philippine_date: string;
        };
        Returns: Json;
      };
      list_aircraft_for_document_status: {
        Args: {
          p_actor_user_id: string;
          p_correlation_id: string;
          p_organization_id: string;
          p_page: number;
          p_page_size: number;
        };
        Returns: Json;
      };
      list_aircraft_records: {
        Args: {
          p_actor_user_id: string;
          p_correlation_id: string;
          p_include_archived: boolean;
          p_organization_id: string;
          p_page: number;
          p_page_size: number;
          p_search: string;
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
      lookup_aircraft_document_idempotency: {
        Args: {
          p_action: string;
          p_actor_user_id: string;
          p_expected_version: number;
          p_idempotency_key_hash: string;
          p_organization_id: string;
          p_permission_code: string;
          p_request_hash: string;
          p_target_id: string;
        };
        Returns: Json;
      };
      lookup_aircraft_registry_idempotency: {
        Args: {
          p_action: string;
          p_actor_user_id: string;
          p_expected_version: number;
          p_idempotency_key_hash: string;
          p_organization_id: string;
          p_record_id: string;
          p_request_hash: string;
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
      member_mfa_active_context: {
        Args: { p_actor_user_id: string };
        Returns: {
          membership_id: string;
          organization_id: string;
          organization_name: string;
        }[];
      };
      member_role_reason_options: { Args: never; Returns: Json };
      member_status_reason_options: {
        Args: { p_action: string };
        Returns: Json;
      };
      mutate_aircraft_document: {
        Args: {
          p_action: string;
          p_actor_user_id: string;
          p_aircraft_record_id: string;
          p_category_id: string;
          p_correlation_id: string;
          p_document_id: string;
          p_document_source: string;
          p_document_title: string;
          p_expected_version: number;
          p_expiration_date: string;
          p_idempotency_key_hash: string;
          p_issue_date: string;
          p_notes: string;
          p_organization_id: string;
          p_philippine_date: string;
          p_reason: string;
          p_reference_number: string;
          p_request_hash: string;
          p_stored_file_id: string;
        };
        Returns: Json;
      };
      mutate_aircraft_document_category: {
        Args: {
          p_action: string;
          p_actor_user_id: string;
          p_aircraft_record_id: string;
          p_category_id: string;
          p_category_label: string;
          p_correlation_id: string;
          p_expected_version: number;
          p_idempotency_key_hash: string;
          p_organization_id: string;
          p_philippine_date: string;
          p_request_hash: string;
        };
        Returns: Json;
      };
      mutate_aircraft_record: {
        Args: {
          p_action: string;
          p_actor_user_id: string;
          p_correlation_id: string;
          p_expected_version: number;
          p_idempotency_key_hash: string;
          p_manufacturer: string;
          p_model: string;
          p_organization_id: string;
          p_reason: string;
          p_record_id: string;
          p_registration_key: string;
          p_registration_mark: string;
          p_request_hash: string;
        };
        Returns: Json;
      };
      open_aircraft_document_notification: {
        Args: {
          p_actor_user_id: string;
          p_correlation_id: string;
          p_membership_id: string;
          p_notification_id: string;
          p_organization_id: string;
        };
        Returns: Json;
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
      reconcile_aircraft_document_storage: {
        Args: {
          p_correlation_id: string;
          p_observed_hashes: Json;
          p_organization_id: string;
        };
        Returns: Json;
      };
      record_aircraft_document_security_event: {
        Args: {
          p_action: string;
          p_actor_user_id: string;
          p_correlation_id: string;
          p_organization_id: string;
          p_outcome: string;
          p_reason: string;
        };
        Returns: undefined;
      };
      record_aircraft_registry_security_event: {
        Args: {
          p_action: string;
          p_actor_user_id: string;
          p_correlation_id: string;
          p_organization_id: string;
          p_outcome: string;
          p_reason: string;
        };
        Returns: undefined;
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
      resolve_aircraft_document_context: {
        Args: { p_actor_user_id: string };
        Returns: Json;
      };
      resolve_aircraft_document_notifications: {
        Args: {
          p_actor_user_id: string;
          p_aircraft_document_id: string;
          p_correlation_id: string;
          p_document_version_id: string;
          p_event_kind: string;
          p_organization_id: string;
          p_resolution_reason: string;
        };
        Returns: number;
      };
      resolve_aircraft_registry_context: {
        Args: { p_actor_user_id: string };
        Returns: Json;
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
      resolve_member_role_assignment_context: {
        Args: {
          p_actor_user_id: string;
          p_correlation_id: string;
          p_expected_version: number;
          p_new_role_code: string;
          p_organization_id: string;
          p_target_membership_id: string;
        };
        Returns: Json;
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
      run_aircraft_document_notification_job: {
        Args: {
          p_correlation_id: string;
          p_organization_id: string;
          p_philippine_date: string;
        };
        Returns: Json;
      };
      seed_aircraft_document_categories: {
        Args: { p_organization_id: string };
        Returns: undefined;
      };
      stage_aircraft_document_file: {
        Args: {
          p_actor_user_id: string;
          p_aircraft_record_id: string;
          p_correlation_id: string;
          p_display_name: string;
          p_file_id: string;
          p_generated_name: string;
          p_media_type: string;
          p_object_key: string;
          p_organization_id: string;
          p_sha256_hash: string;
          p_size_bytes: number;
        };
        Returns: Json;
      };
      start_member_mfa_enrollment: {
        Args: {
          p_actor_user_id: string;
          p_correlation_id: string;
          p_factor_reference_hash: string;
          p_idempotency_key_hash: string;
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
      sync_aircraft_document_notifications: {
        Args: {
          p_actor_user_id: string;
          p_aircraft_document_id: string;
          p_correlation_id: string;
          p_document_version_id: string;
          p_organization_id: string;
          p_philippine_date: string;
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
      write_aircraft_document_event: {
        Args: {
          p_actor_user_id: string;
          p_correlation_id: string;
          p_event_name: string;
          p_idempotency_key_hash?: string;
          p_metadata?: Json;
          p_organization_id: string;
          p_outcome: string;
          p_reason_code: string;
          p_target_id: string;
          p_target_type: string;
        };
        Returns: undefined;
      };
      write_aircraft_registry_event: {
        Args: {
          p_actor_user_id: string;
          p_correlation_id: string;
          p_event_name: string;
          p_idempotency_key_hash?: string;
          p_metadata?: Json;
          p_organization_id: string;
          p_outcome: string;
          p_reason_code: string;
          p_target_record_id: string;
        };
        Returns: undefined;
      };
      write_member_administration_event: {
        Args: {
          p_actor_user_id: string;
          p_correlation_id: string;
          p_event_name: string;
          p_idempotency_key_hash?: string;
          p_metadata?: Json;
          p_organization_id: string;
          p_outcome: string;
          p_reason_code: string;
          p_target_membership_id: string;
        };
        Returns: string;
      };
      write_member_mfa_event: {
        Args: {
          p_actor_user_id: string;
          p_correlation_id: string;
          p_event_name: string;
          p_idempotency_key_hash?: string;
          p_membership_id?: string;
          p_metadata?: Json;
          p_operation_id?: string;
          p_organization_id?: string;
          p_outcome: string;
          p_reason_code: string;
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
