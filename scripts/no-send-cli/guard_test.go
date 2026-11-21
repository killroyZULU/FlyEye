package flyeyeloopback

import (
	"reflect"
	"testing"
)

func TestAllowedServices(t *testing.T) {
	cases := map[string]map[string][]Binding{
		"db":       {"5432/tcp": {{HostPort: "58322"}}},
		"kong":     {"8000/tcp": {{HostPort: "58321"}}},
		"inbucket": {"8025/tcp": {{HostPort: "58324"}}, "1025/tcp": {{HostPort: "58325"}}, "1110/tcp": {{HostPort: "58326"}}},
		"auth":     {}, "rest": {},
	}
	for service, ports := range cases {
		t.Run(service, func(t *testing.T) {
			if err := Apply(Project, Network, "supabase_"+service+"_"+Project, []string{Network}, false, ports); err != nil {
				t.Fatal(err)
			}
			for _, entries := range ports {
				if entries[0].HostIP != "127.0.0.1" {
					t.Fatal("missing loopback")
				}
			}
			if err := Apply(Project, Network, "supabase_"+service+"_"+Project, []string{Network}, false, ports); err != nil {
				t.Fatal("not idempotent")
			}
		})
	}
}

func TestRejectWithoutMutation(t *testing.T) {
	type input struct {
		project, network, name string
		endpoints              []string
		all                    bool
		ports                  map[string][]Binding
	}
	cases := map[string]func(*input){
		"project":                 func(i *input) { i.project = "secret-canary" },
		"network":                 func(i *input) { i.network = "secret-canary" },
		"service":                 func(i *input) { i.name = "supabase_storage_" + Project },
		"other-project-container": func(i *input) { i.name = "supabase_db_other" },
		"missing-network":         func(i *input) { i.endpoints = nil },
		"wrong-network":           func(i *input) { i.endpoints = []string{"other"} },
		"extra-network":           func(i *input) { i.endpoints = append(i.endpoints, "other") },
		"publish-all":             func(i *input) { i.all = true },
		"missing-port":            func(i *input) { i.ports = nil },
		"extra-port":              func(i *input) { i.ports["80/tcp"] = []Binding{{HostPort: "58321"}} },
		"udp":                     func(i *input) { i.ports = map[string][]Binding{"5432/udp": {{HostPort: "58322"}}} },
		"empty-entries":           func(i *input) { i.ports["5432/tcp"] = nil },
		"duplicate-binding":       func(i *input) { i.ports["5432/tcp"] = append(i.ports["5432/tcp"], Binding{HostPort: "58322"}) },
		"wrong-port":              func(i *input) { i.ports["5432/tcp"][0].HostPort = "54322" },
		"empty-host-port":         func(i *input) { i.ports["5432/tcp"][0].HostPort = "" },
		"ipv4-wildcard":           func(i *input) { i.ports["5432/tcp"][0].HostIP = "0.0.0.0" },
		"ipv6-wildcard":           func(i *input) { i.ports["5432/tcp"][0].HostIP = "::" },
		"ipv6-loopback":           func(i *input) { i.ports["5432/tcp"][0].HostIP = "::1" },
		"nonloopback":             func(i *input) { i.ports["5432/tcp"][0].HostIP = "secret-canary" },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			i := input{Project, Network, "supabase_db_" + Project, []string{Network}, false, map[string][]Binding{"5432/tcp": {{HostPort: "58322"}}}}
			change(&i)
			var before map[string][]Binding
			if i.ports != nil {
				before = map[string][]Binding{}
				for key, value := range i.ports {
					before[key] = append([]Binding(nil), value...)
				}
			}
			if err := Apply(i.project, i.network, i.name, i.endpoints, i.all, i.ports); err != ErrRejected {
				t.Fatal("expected fixed rejection")
			}
			if !reflect.DeepEqual(before, i.ports) {
				t.Fatal("rejected input mutated")
			}
		})
	}
}
