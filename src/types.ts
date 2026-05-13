export interface UserConfig {
  roofArea: number;
  tankCapacity: number;
  runoffCoefficient: number;
  updatedAt: any; // Firestore Timestamp
}

export interface RainfallEntry {
  id?: string;
  date: string;
  rainfallMm: number;
  litersCollected: number;
  createdAt: any; // Firestore Timestamp
}

export interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
}
