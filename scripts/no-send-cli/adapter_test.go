package utils

import (
	"encoding/json"
	"fmt"
	configpkg "github.com/supabase/cli/pkg/config"
	"reflect"
	"strings"
	"testing"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/go-connections/nat"
	"github.com/spf13/viper"
	"github.com/supabase/cli/internal/flyeyeloopback"
)

// This test lives in an isolated package containing only the copied adapter.
// It never imports the upstream utils package or initializes a Docker client.
var Config = struct{ ProjectId string }{flyeyeloopback.Project}

func TestAdapterPreservesUnrelatedConfiguration(t *testing.T) {
	viper.Set("network-id", flyeyeloopback.Network)
	t.Cleanup(viper.Reset)
	host := container.HostConfig{
		PortBindings:  nat.PortMap{"5432/tcp": {{HostPort: "58322"}}},
		Binds:         []string{"synthetic-volume:/synthetic"},
		ExtraHosts:    []string{"synthetic:127.0.0.1"},
		RestartPolicy: container.RestartPolicy{Name: container.RestartPolicyUnlessStopped},
	}
	expected := host
	expected.PortBindings = nat.PortMap{"5432/tcp": {{HostIP: "127.0.0.1", HostPort: "58322"}}}
	networking := network.NetworkingConfig{EndpointsConfig: map[string]*network.EndpointSettings{flyeyeloopback.Network: {Aliases: []string{"db"}}}}
	if err := flyEyeBindLoopback(container.Config{}, &host, networking, "supabase_db_"+flyeyeloopback.Project); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(host, expected) {
		t.Fatal("unrelated host configuration changed")
	}
	if !reflect.DeepEqual(networking.EndpointsConfig[flyeyeloopback.Network].Aliases, []string{"db"}) {
		t.Fatal("network configuration changed")
	}
}

func TestAdapterRejectsWithoutMutation(t *testing.T) {
	viper.Set("network-id", flyeyeloopback.Network)
	t.Cleanup(viper.Reset)
	for _, host := range []container.HostConfig{
		{NetworkMode: "host", PortBindings: nat.PortMap{"5432/tcp": {{HostPort: "58322"}}}},
		{PortBindings: nat.PortMap{"5432/tcp": nil}},
		{PortBindings: nat.PortMap{"5432/tcp": {{HostIP: "secret-canary", HostPort: "58322"}}}},
	} {
		snapshot, err := json.Marshal(host)
		if err != nil {
			t.Fatal(err)
		}
		var before container.HostConfig
		if err := json.Unmarshal(snapshot, &before); err != nil {
			t.Fatal(err)
		}
		networking := network.NetworkingConfig{EndpointsConfig: map[string]*network.EndpointSettings{flyeyeloopback.Network: {}}}
		if err := flyEyeBindLoopback(container.Config{}, &host, networking, "supabase_db_"+flyeyeloopback.Project); err != flyeyeloopback.ErrRejected {
			t.Fatal("expected fixed rejection")
		}
		if !reflect.DeepEqual(before, host) {
			t.Fatal("rejected host configuration changed")
		}
	}
}

func TestAdapterRejectsExplicitNetworkIdentity(t *testing.T) {
	viper.Set("network-id", flyeyeloopback.Network)
	t.Cleanup(viper.Reset)
	for _, settings := range []*network.EndpointSettings{nil, {NetworkID: "foreign-network-id"}} {
		host := container.HostConfig{PortBindings: nat.PortMap{"5432/tcp": {{HostPort: "58322"}}}}
		networking := network.NetworkingConfig{EndpointsConfig: map[string]*network.EndpointSettings{flyeyeloopback.Network: settings}}
		if err := flyEyeBindLoopback(container.Config{}, &host, networking, "supabase_db_"+flyeyeloopback.Project); err != flyeyeloopback.ErrRejected {
			t.Fatal("expected fixed rejection")
		}
		if host.PortBindings["5432/tcp"][0].HostIP != "" {
			t.Fatal("rejected binding mutated")
		}
	}
}

// These factory bodies are copied from the pinned CLI commit
// 6d4c19870ed213ba7f682f117d0345c8a40bfa94, internal/db/start/start.go.
// Only utils references and the returned type are adapted. No Docker import,
// daemon, filesystem, provider, or network operation is involved.
var fixtureConfig = configpkg.NewConfig()

func fixtureRealtimeEnv(address configpkg.AddressFamily) string {
	if address == configpkg.AddressIPv6 {
		return "-proto_dist inet6_tcp"
	}
	return "-proto_dist inet_tcp"
}
func initRealtimeJob(host, jwks string) container.Config {
	return container.Config{
		Image: fixtureConfig.Realtime.Image,
		Env: []string{
			"PORT=4000",
			"DB_HOST=" + host,
			"DB_PORT=5432",
			"DB_USER=" + "supabase_admin",
			"DB_PASSWORD=" + fixtureConfig.Db.Password,
			"DB_NAME=postgres",
			"DB_AFTER_CONNECT_QUERY=SET search_path TO _realtime",
			"DB_ENC_KEY=" + fixtureConfig.Realtime.EncryptionKey,
			fmt.Sprintf("API_JWT_JWKS=%s", jwks),
			"API_JWT_SECRET=" + fixtureConfig.Auth.JwtSecret.Value,
			"METRICS_JWT_SECRET=" + fixtureConfig.Auth.JwtSecret.Value,
			"APP_NAME=realtime",
			"SECRET_KEY_BASE=" + fixtureConfig.Realtime.SecretKeyBase,
			"ERL_AFLAGS=" + fixtureRealtimeEnv(fixtureConfig.Realtime.IpVersion),
			"DNS_NODES=''",
			"RLIMIT_NOFILE=",
			"SEED_SELF_HOST=true",
			"RUN_JANITOR=true",
			fmt.Sprintf("MAX_HEADER_LENGTH=%d", fixtureConfig.Realtime.MaxHeaderLength),
		},
		Cmd: []string{"/app/bin/realtime", "eval", fmt.Sprintf(`{:ok, _} = Application.ensure_all_started(:realtime)
{:ok, _} = Realtime.Tenants.health_check("%s")`, fixtureConfig.Realtime.TenantId)},
	}
}

func initStorageJob(host string) container.Config {
	return container.Config{
		Image: fixtureConfig.Storage.Image,
		Env: []string{
			"DB_INSTALL_ROLES=false",
			"DB_MIGRATIONS_FREEZE_AT=" + fixtureConfig.Storage.TargetMigration,
			"ANON_KEY=" + fixtureConfig.Auth.AnonKey.Value,
			"SERVICE_KEY=" + fixtureConfig.Auth.ServiceRoleKey.Value,
			"PGRST_JWT_SECRET=" + fixtureConfig.Auth.JwtSecret.Value,
			fmt.Sprintf("DATABASE_URL=postgresql://supabase_storage_admin:%s@%s:5432/postgres", fixtureConfig.Db.Password, host),
			fmt.Sprintf("FILE_SIZE_LIMIT=%v", fixtureConfig.Storage.FileSizeLimit),
			"STORAGE_BACKEND=file",
			"STORAGE_FILE_BACKEND_PATH=/mnt",
			"TENANT_ID=stub",
			// TODO: https://github.com/supabase/storage-api/issues/55
			"REGION=stub",
			"GLOBAL_S3_BUCKET=stub",
		},
		Cmd: []string{"node", "dist/scripts/migrate-call.js"},
	}
}

func initAuthJob(host string) container.Config {
	return container.Config{
		Image: fixtureConfig.Auth.Image,
		Env: []string{
			"API_EXTERNAL_URL=" + fixtureConfig.AuthExternalURL(),
			"GOTRUE_LOG_LEVEL=error",
			"GOTRUE_DB_DRIVER=postgres",
			fmt.Sprintf("GOTRUE_DB_DATABASE_URL=postgresql://supabase_auth_admin:%s@%s:5432/postgres", fixtureConfig.Db.Password, host),
			"GOTRUE_SITE_URL=" + fixtureConfig.Auth.SiteUrl,
			"GOTRUE_JWT_SECRET=" + fixtureConfig.Auth.JwtSecret.Value,
		},
		Cmd: []string{"gotrue", "migrate"},
	}
}

func initializationFixtures() map[string]container.Config {
	fixtureConfig = configpkg.NewConfig()
	fixtureConfig.Api.ExternalUrl = "http://127.0.0.1:58321"
	fixtureConfig.Auth.SiteUrl = "http://127.0.0.1:58329"
	fixtureConfig.Db.Password = "synthetic-password"
	fixtureConfig.Auth.JwtSecret.Value = "synthetic-jwt"
	fixtureConfig.Auth.AnonKey.Value = "synthetic-anon"
	fixtureConfig.Auth.ServiceRoleKey.Value = "synthetic-service"
	fixtureConfig.Storage.FileSizeLimit = 52428800
	fixtureConfig.Realtime.EncryptionKey = "synthetic-encryption"
	fixtureConfig.Realtime.SecretKeyBase = "synthetic-base"
	host := "supabase_db_" + flyeyeloopback.Project
	return map[string]container.Config{
		"auth": initAuthJob(host), "storage": initStorageJob(host), "realtime": initRealtimeJob(host, "{\"keys\":[]}"),
	}
}

func TestPinnedInitializationJobs(t *testing.T) {
	viper.Set("network-id", flyeyeloopback.Network)
	t.Cleanup(viper.Reset)
	for name, payload := range initializationFixtures() {
		t.Run(name, func(t *testing.T) {
			host := container.HostConfig{}
			networkConfig := network.NetworkingConfig{}
			before, _ := json.Marshal(payload)
			if err := flyEyeBindLoopback(payload, &host, networkConfig, ""); err != nil {
				t.Fatal("pinned initialization shape rejected")
			}
			after, _ := json.Marshal(payload)
			if string(before) != string(after) || !reflect.DeepEqual(host, container.HostConfig{}) || !reflect.DeepEqual(networkConfig, network.NetworkingConfig{}) {
				t.Fatal("initializer configuration mutated")
			}
		})
	}
}

func TestInitializationRejectsPayloadChanges(t *testing.T) {
	changes := map[string]func(*container.Config){
		"image":                 func(c *container.Config) { c.Image = "foreign/image:latest" },
		"image-tag":             func(c *container.Config) { c.Image += "-other" },
		"command":               func(c *container.Config) { c.Cmd = []string{"sh", "-c", "synthetic-canary"} },
		"extra-argument":        func(c *container.Config) { c.Cmd = append(c.Cmd, "synthetic-canary") },
		"entrypoint":            func(c *container.Config) { c.Entrypoint = []string{"sh"} },
		"exposed-port":          func(c *container.Config) { c.ExposedPorts = nat.PortSet{"80/tcp": {}} },
		"volume":                func(c *container.Config) { c.Volumes = map[string]struct{}{"/mnt": {}} },
		"label":                 func(c *container.Config) { c.Labels = map[string]string{"unexpected": "true"} },
		"user":                  func(c *container.Config) { c.User = "root" },
		"working-dir":           func(c *container.Config) { c.WorkingDir = "/tmp" },
		"healthcheck":           func(c *container.Config) { c.Healthcheck = &container.HealthConfig{Test: []string{"NONE"}} },
		"extra-environment":     func(c *container.Config) { c.Env = append(c.Env, "HTTP_PROXY=synthetic-canary") },
		"smtp-environment":      func(c *container.Config) { c.Env = append(c.Env, "GOTRUE_SMTP_HOST=synthetic-canary") },
		"duplicate-environment": func(c *container.Config) { c.Env = append(c.Env, c.Env[0]) },
		"malformed-environment": func(c *container.Config) { c.Env = append(c.Env, "missing-equals") },
		"missing-environment":   func(c *container.Config) { c.Env = c.Env[1:] },
		"foreign-database": func(c *container.Config) {
			for n, value := range c.Env {
				c.Env[n] = strings.ReplaceAll(value, "supabase_db_"+flyeyeloopback.Project, "foreign-db")
			}
		},
	}
	viper.Set("network-id", flyeyeloopback.Network)
	t.Cleanup(viper.Reset)
	for job := range initializationFixtures() {
		for name, change := range changes {
			t.Run(job+"/"+name, func(t *testing.T) {
				payload := initializationFixtures()[job]
				change(&payload)
				host := container.HostConfig{}
				before, _ := json.Marshal(payload)
				err := flyEyeBindLoopback(payload, &host, network.NetworkingConfig{}, "")
				if err != flyeyeloopback.ErrRejected || strings.Contains(err.Error(), "synthetic-canary") {
					t.Fatal("expected fixed private rejection")
				}
				after, _ := json.Marshal(payload)
				if string(before) != string(after) || !reflect.DeepEqual(host, container.HostConfig{}) {
					t.Fatal("rejected input mutated")
				}
			})
		}
	}
}

func TestInitializationRejectsHostAndTargetChanges(t *testing.T) {
	viper.Set("network-id", flyeyeloopback.Network)
	t.Cleanup(viper.Reset)
	payload := initializationFixtures()["auth"]
	hosts := map[string]container.HostConfig{
		"binding":     {PortBindings: nat.PortMap{"80/tcp": {{HostPort: "58321"}}}},
		"publish-all": {PublishAllPorts: true},
		"bind":        {Binds: []string{"/host:/container"}},
		"network":     {NetworkMode: "host"},
		"privileged":  {Privileged: true},
		"restart":     {RestartPolicy: container.RestartPolicy{Name: container.RestartPolicyAlways}},
		"extra-host":  {ExtraHosts: []string{"foreign:127.0.0.1"}},
	}
	for name, host := range hosts {
		t.Run(name, func(t *testing.T) {
			before, _ := json.Marshal(host)
			if err := flyEyeBindLoopback(payload, &host, network.NetworkingConfig{}, ""); err != flyeyeloopback.ErrRejected {
				t.Fatal("unexpected host settings accepted")
			}
			after, _ := json.Marshal(host)
			if string(before) != string(after) {
				t.Fatal("rejected host mutated")
			}
		})
	}
	host := container.HostConfig{}
	if err := flyEyeBindLoopback(payload, nil, network.NetworkingConfig{}, ""); err != flyeyeloopback.ErrRejected {
		t.Fatal("nil host accepted")
	}
	for _, endpoint := range []string{flyeyeloopback.Network, "foreign"} {
		networking := network.NetworkingConfig{EndpointsConfig: map[string]*network.EndpointSettings{endpoint: {}}}
		if err := flyEyeBindLoopback(payload, &host, networking, ""); err != flyeyeloopback.ErrRejected {
			t.Fatal("unexpected endpoint accepted")
		}
	}
	for _, name := range []string{"temporary-name", "supabase_storage_" + flyeyeloopback.Project} {
		if err := flyEyeBindLoopback(payload, &host, network.NetworkingConfig{}, name); err != flyeyeloopback.ErrRejected {
			t.Fatal("unexpected named job accepted")
		}
	}
	viper.Set("network-id", "foreign")
	if err := flyEyeBindLoopback(payload, &host, network.NetworkingConfig{}, ""); err != flyeyeloopback.ErrRejected {
		t.Fatal("foreign network accepted")
	}
	viper.Set("network-id", flyeyeloopback.Network)
	Config.ProjectId = "foreign"
	defer func() { Config.ProjectId = flyeyeloopback.Project }()
	if err := flyEyeBindLoopback(payload, &host, network.NetworkingConfig{}, ""); err != flyeyeloopback.ErrRejected {
		t.Fatal("foreign project accepted")
	}
}

func TestInitializationRejectsDatabaseURLChanges(t *testing.T) {
	viper.Set("network-id", flyeyeloopback.Network)
	t.Cleanup(viper.Reset)
	changes := map[string]func(string) string{
		"scheme":         func(value string) string { return strings.Replace(value, "postgresql:", "https:", 1) },
		"user":           func(value string) string { return strings.Replace(value, "supabase_", "foreign_", 1) },
		"port":           func(value string) string { return strings.Replace(value, ":5432/", ":5433/", 1) },
		"database":       func(value string) string { return strings.Replace(value, "/postgres", "/foreign", 1) },
		"escaped-path":   func(value string) string { return strings.Replace(value, "/postgres", "/%70ostgres", 1) },
		"query":          func(value string) string { return value + "?host=foreign" },
		"empty-query":    func(value string) string { return value + "?" },
		"fragment":       func(value string) string { return value + "#foreign" },
		"no-password":    func(value string) string { return strings.Replace(value, ":synthetic-password@", "@", 1) },
		"empty-password": func(value string) string { return strings.Replace(value, ":synthetic-password@", ":@", 1) },
		"malformed":      func(string) string { return "%synthetic-canary" },
	}
	for job, key := range map[string]string{"auth": "GOTRUE_DB_DATABASE_URL", "storage": "DATABASE_URL"} {
		for name, change := range changes {
			t.Run(job+"/"+name, func(t *testing.T) {
				payload := initializationFixtures()[job]
				for i, entry := range payload.Env {
					if strings.HasPrefix(entry, key+"=") {
						payload.Env[i] = key + "=" + change(strings.TrimPrefix(entry, key+"="))
					}
				}
				host := container.HostConfig{}
				if err := flyEyeBindLoopback(payload, &host, network.NetworkingConfig{}, ""); err != flyeyeloopback.ErrRejected {
					t.Fatal("altered database URL accepted")
				}
			})
		}
	}
}

func TestInitializationRequiresEveryEnvironmentKey(t *testing.T) {
	viper.Set("network-id", flyeyeloopback.Network)
	t.Cleanup(viper.Reset)
	for job, fixture := range initializationFixtures() {
		for index, entry := range fixture.Env {
			key, _, _ := strings.Cut(entry, "=")
			t.Run(job+"/"+key, func(t *testing.T) {
				payload := initializationFixtures()[job]
				payload.Env = append(payload.Env[:index], payload.Env[index+1:]...)
				host := container.HostConfig{}
				if err := flyEyeBindLoopback(payload, &host, network.NetworkingConfig{}, ""); err != flyeyeloopback.ErrRejected {
					t.Fatal("missing required environment key accepted")
				}
			})
		}
	}
}

func TestInitializationRejectsFixedEnvironmentChanges(t *testing.T) {
	viper.Set("network-id", flyeyeloopback.Network)
	t.Cleanup(viper.Reset)
	keys := map[string][]string{
		"auth":     {"API_EXTERNAL_URL", "GOTRUE_SITE_URL", "GOTRUE_LOG_LEVEL", "GOTRUE_DB_DRIVER"},
		"storage":  {"DB_INSTALL_ROLES", "DB_MIGRATIONS_FREEZE_AT", "STORAGE_BACKEND", "STORAGE_FILE_BACKEND_PATH", "TENANT_ID", "REGION", "GLOBAL_S3_BUCKET", "FILE_SIZE_LIMIT"},
		"realtime": {"PORT", "DB_HOST", "DB_PORT", "DB_USER", "DB_NAME", "DB_AFTER_CONNECT_QUERY", "APP_NAME", "ERL_AFLAGS", "DNS_NODES", "RLIMIT_NOFILE", "SEED_SELF_HOST", "RUN_JANITOR", "MAX_HEADER_LENGTH"},
	}
	for job, fields := range keys {
		for _, key := range fields {
			t.Run(job+"/"+key, func(t *testing.T) {
				payload := initializationFixtures()[job]
				for i, entry := range payload.Env {
					if strings.HasPrefix(entry, key+"=") {
						payload.Env[i] = key + "=synthetic-canary"
					}
				}
				host := container.HostConfig{}
				if err := flyEyeBindLoopback(payload, &host, network.NetworkingConfig{}, ""); err != flyeyeloopback.ErrRejected {
					t.Fatal("altered fixed environment setting accepted")
				}
			})
		}
	}
}
