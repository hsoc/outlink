import Storage from 'expo-sqlite/kv-store';
import * as Location from 'expo-location';
import type { PreferencesPort, LocationPort } from '../ports/mobile';
export const preferencesAdapter: PreferencesPort = {
  getItem: (key) => Storage.getItem(key), setItem: (key, value) => Storage.setItem(key, value),
  deleteItem: (key) => Storage.removeItem(key),
};
export const locationAdapter: LocationPort = {
  async currentCoordinates() {
    if (!(await Location.requestForegroundPermissionsAsync()).granted) throw new Error('Location permission denied');
    const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { latitude: coords.latitude, longitude: coords.longitude };
  },
};
