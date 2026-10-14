import { Redirect } from 'expo-router';

/** Legacy registration links return to the normal account entry point. */
export default function OnboardingNip05() {
  return <Redirect href="/" />;
}
