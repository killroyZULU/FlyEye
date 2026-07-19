import { AuthApp } from './features/auth/AuthApp';
import type { AuthGateway } from './features/auth/services/auth-gateway';

type AppProps = {
  gateway: AuthGateway;
};

export function App({ gateway }: AppProps) {
  return <AuthApp gateway={gateway} />;
}
