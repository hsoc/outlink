import { privateStorage } from './private-storage';
import * as Location from 'expo-location';
import type { PreferencesPort, LocationPort } from '../ports/mobile';
export const preferencesAdapter: PreferencesPort = privateStorage.preferences;
export const locationAdapter: LocationPort = {
  async currentCoordinates() {
    if (!(await Location.requestForegroundPermissionsAsync()).granted) throw new Error('Location permission denied');
    const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { latitude: coords.latitude, longitude: coords.longitude };
  },
};
