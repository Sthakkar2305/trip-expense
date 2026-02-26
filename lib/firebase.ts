// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyA16X4hK2h2B8xdZGNr4VOewktNLn07qU0",
  authDomain: "tripsplit-app-e646d.firebaseapp.com",
  projectId: "tripsplit-app-e646d",
  storageBucket: "tripsplit-app-e646d.firebasestorage.app",
  messagingSenderId: "927829295249",
  appId: "1:927829295249:web:2f5231f8b55923f4607f30",
  measurementId: "G-EFEZNJQSV1"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
let analytics = getAnalytics(app);

const db = getFirestore(app);


if (typeof window !== "undefined") {
  isSupported().then((supported) => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  });
}

export { db , analytics };