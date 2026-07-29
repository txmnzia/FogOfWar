import { isConfigured } from "./lib/env";
import { SetupScreen } from "./components/SetupScreen";
import { AuthGate } from "./components/AuthGate";
import { MapApp } from "./components/MapApp";

export default function App() {
  if (!isConfigured) return <SetupScreen />;
  return <AuthGate>{(session) => <MapApp userId={session.user.id} email={session.user.email ?? ""} />}</AuthGate>;
}
