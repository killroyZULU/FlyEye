package utils

import (
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/network"
	"github.com/spf13/viper"
	"github.com/supabase/cli/internal/flyeyeloopback"
	"reflect"
)

func flyEyeBindLoopback(config container.Config, host *container.HostConfig, networking network.NetworkingConfig, name string) error {
	networkID := viper.GetString("network-id")
	if name == "" {
		// The pinned DockerRunJob path supplies only Image, Env and Cmd. Reject
		// all other container/host/network options, including mounts and ports.
		payload := container.Config{Image: config.Image, Env: config.Env, Cmd: config.Cmd}
		if host == nil || !reflect.DeepEqual(*host, container.HostConfig{}) ||
			!reflect.DeepEqual(networking, network.NetworkingConfig{}) || !reflect.DeepEqual(config, payload) {
			return flyeyeloopback.ErrRejected
		}
		// DockerStart subsequently selects this exact network from network-id.
		return flyeyeloopback.ValidateInitialization(Config.ProjectId, networkID, config.Image, config.Cmd, config.Env)
	}
	if host == nil {
		return flyeyeloopback.ErrRejected
	}
	if host.NetworkMode != "" && string(host.NetworkMode) != networkID {
		return flyeyeloopback.ErrRejected
	}
	endpoints := make([]string, 0, len(networking.EndpointsConfig))
	for endpoint, settings := range networking.EndpointsConfig {
		if settings == nil || settings.NetworkID != "" {
			return flyeyeloopback.ErrRejected
		}
		endpoints = append(endpoints, endpoint)
	}
	bindings := make(map[string][]flyeyeloopback.Binding, len(host.PortBindings))
	for port, entries := range host.PortBindings {
		for _, entry := range entries {
			bindings[string(port)] = append(bindings[string(port)], flyeyeloopback.Binding{HostIP: entry.HostIP, HostPort: entry.HostPort})
		}
		if len(entries) == 0 {
			bindings[string(port)] = nil
		}
	}
	if err := flyeyeloopback.Apply(Config.ProjectId, networkID, name, endpoints, host.PublishAllPorts, bindings); err != nil {
		return err
	}
	for port, entries := range host.PortBindings {
		for index := range entries {
			entries[index].HostIP = bindings[string(port)][index].HostIP
		}
		host.PortBindings[port] = entries
	}
	return nil
}
