// Local verification derivative; upstream CLI remains separately installed.
package flyeyeloopback

import (
	"errors"
	"net/url"
	"reflect"
	"strconv"
	"strings"
)

const Project = "flyeye-nosend-p3d1"
const Network = Project + "-isolated"

var ErrRejected = errors.New("FlyEye disposable binding target rejected")

type Binding struct {
	HostIP   string
	HostPort string
}

// ValidateInitialization accepts only the three schema jobs constructed by the
// pinned CLI's internal/db/start/start.go. It performs no IO or mutation.
// DockerRunJob supplies an unnamed container with otherwise empty Docker configs;
// the adapter checks that shape before this function validates its payload.
func ValidateInitialization(project, network, image string, command, environment []string) error {
	if project != Project || network != Network {
		return ErrRejected
	}
	var expectedCommand []string
	var fixed map[string]string
	var variable []string
	var databaseKey, databaseUser string
	switch image {
	case "supabase/gotrue:v2.192.0":
		expectedCommand = []string{"gotrue", "migrate"}
		fixed = map[string]string{
			"API_EXTERNAL_URL": "http://127.0.0.1:58321/auth/v1", "GOTRUE_SITE_URL": "http://127.0.0.1:58329",
			"GOTRUE_LOG_LEVEL": "error", "GOTRUE_DB_DRIVER": "postgres",
		}
		variable = []string{"GOTRUE_JWT_SECRET"}
		databaseKey, databaseUser = "GOTRUE_DB_DATABASE_URL", "supabase_auth_admin"
	case "supabase/storage-api:v1.62.5":
		expectedCommand = []string{"node", "dist/scripts/migrate-call.js"}
		fixed = map[string]string{
			"DB_INSTALL_ROLES": "false", "STORAGE_BACKEND": "file", "STORAGE_FILE_BACKEND_PATH": "/mnt",
			"TENANT_ID": "stub", "REGION": "stub", "GLOBAL_S3_BUCKET": "stub",
			"DB_MIGRATIONS_FREEZE_AT": "", // Fresh disposable project has no retained migration version.
		}
		variable = []string{"ANON_KEY", "SERVICE_KEY", "PGRST_JWT_SECRET", "FILE_SIZE_LIMIT"}
		databaseKey, databaseUser = "DATABASE_URL", "supabase_storage_admin"
	case "supabase/realtime:v2.112.6":
		expectedCommand = []string{"/app/bin/realtime", "eval", "{:ok, _} = Application.ensure_all_started(:realtime)\n{:ok, _} = Realtime.Tenants.health_check(\"realtime-dev\")"}
		fixed = map[string]string{
			"PORT": "4000", "DB_HOST": "supabase_db_" + Project, "DB_PORT": "5432", "DB_USER": "supabase_admin",
			"DB_NAME": "postgres", "DB_AFTER_CONNECT_QUERY": "SET search_path TO _realtime", "APP_NAME": "realtime",
			"ERL_AFLAGS": "-proto_dist inet_tcp", "DNS_NODES": "''", "RLIMIT_NOFILE": "",
			"SEED_SELF_HOST": "true", "RUN_JANITOR": "true", "MAX_HEADER_LENGTH": "4096",
		}
		variable = []string{"DB_PASSWORD", "DB_ENC_KEY", "API_JWT_JWKS", "API_JWT_SECRET", "METRICS_JWT_SECRET", "SECRET_KEY_BASE"}
	default:
		return ErrRejected
	}
	if !reflect.DeepEqual(command, expectedCommand) {
		return ErrRejected
	}
	values := make(map[string]string, len(environment))
	for _, entry := range environment {
		key, value, ok := strings.Cut(entry, "=")
		if _, duplicate := values[key]; !ok || duplicate {
			return ErrRejected
		}
		values[key] = value
	}
	for key, value := range fixed {
		if actual, present := values[key]; !present || actual != value {
			return ErrRejected
		}
		delete(values, key)
	}
	for _, key := range variable {
		if value, present := values[key]; !present || value == "" {
			return ErrRejected
		}
		if key == "FILE_SIZE_LIMIT" {
			if _, err := strconv.ParseUint(values[key], 10, 64); err != nil {
				return ErrRejected
			}
		}
		delete(values, key)
	}
	if databaseKey != "" {
		connection, err := url.Parse(values[databaseKey])
		if err != nil || connection.Scheme != "postgresql" || connection.Opaque != "" ||
			connection.Host != "supabase_db_"+Project+":5432" || connection.Path != "/postgres" ||
			connection.RawPath != "" || connection.RawQuery != "" || connection.ForceQuery || connection.Fragment != "" ||
			connection.User == nil || connection.User.Username() != databaseUser {
			return ErrRejected
		}
		if password, present := connection.User.Password(); !present || password == "" {
			return ErrRejected
		}
		delete(values, databaseKey)
	}
	if len(values) != 0 {
		return ErrRejected
	}
	return nil
}

// Apply validates every mapping before changing any HostIP. It performs no IO.
func Apply(project, network, name string, endpoints []string, publishAll bool, bindings map[string][]Binding) error {
	if project != Project || network != Network || publishAll || len(endpoints) != 1 || endpoints[0] != Network {
		return ErrRejected
	}
	allowed := map[string]map[string]string{
		"supabase_db_" + Project:       {"5432/tcp": "58322"},
		"supabase_kong_" + Project:     {"8000/tcp": "58321"},
		"supabase_inbucket_" + Project: {"8025/tcp": "58324", "1025/tcp": "58325", "1110/tcp": "58326"},
		"supabase_auth_" + Project:     {},
		"supabase_rest_" + Project:     {},
	}
	expected, ok := allowed[name]
	if !ok || len(bindings) != len(expected) {
		return ErrRejected
	}
	for port, entries := range bindings {
		hostPort, ok := expected[port]
		if !ok || len(entries) != 1 || entries[0].HostPort != hostPort || (entries[0].HostIP != "" && entries[0].HostIP != "127.0.0.1") {
			return ErrRejected
		}
	}
	for port, entries := range bindings {
		entries[0].HostIP = "127.0.0.1"
		bindings[port] = entries
	}
	return nil
}
