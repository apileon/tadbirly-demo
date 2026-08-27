import { Redirect } from 'expo-router';

// Entry point simply hands off to the tab group; _layout handles auth redirects.
export default function Index() {
  return <Redirect href="/(tabs)" />;
}
