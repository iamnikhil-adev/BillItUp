import { initializeApp } from "firebase/app";
import { getFirestore, enableIndexedDbPersistence } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCc6tPMKEunXZcjfEhDbU9OyYt93551bzA",
  authDomain: "billitup-aefff.firebaseapp.com",
  projectId: "billitup-aefff",
  storageBucket: "billitup-aefff.firebasestorage.app",
  messagingSenderId: "1051296207544",
  appId: "1:1051296207544:web:18c201bfa361742dac5a4d"
};

const isConfigured = !!firebaseConfig.apiKey && firebaseConfig.apiKey !== 'your_api_key_here';

let db: any = null;
let auth: any = null;

if (isConfigured) {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
  
  // Enable offline persistence
  enableIndexedDbPersistence(db).catch((err) => {
    if (err.code == 'failed-precondition') {
      console.warn("Multiple tabs open, persistence can only be enabled in one tab at a a time.");
    } else if (err.code == 'unimplemented') {
      console.warn("The current browser does not support all of the features required to enable persistence");
    }
  });
}

export const firestore = db;
export const firebaseAuth = auth;
export const isFirebaseConfigured = isConfigured;
