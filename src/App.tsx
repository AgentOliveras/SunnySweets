import React, { useState, useEffect } from 'react';
import { store } from './services/store';
import { auth } from './services/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { LoadingAuthenticationScreen } from './components/LoadingAuthenticationScreen';
import { SignInScreen } from './components/SignInScreen';
import { AccessDeniedScreen } from './components/AccessDeniedScreen';
import { AuthorizedRecipeCalculatorApp } from './components/AuthorizedRecipeCalculatorApp';

export default function App() {
  const [authLoading, setAuthLoading] = useState(store.isAuthLoading());
  const [currentUser, setCurrentUser] = useState<User | null>(auth.currentUser);
  const [canAccess, setCanAccess] = useState(store.canAccessApp());

  useEffect(() => {
    store.initFirebaseSync();

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthLoading(store.isAuthLoading());
      setCanAccess(store.canAccessApp());
    });

    const unsubStore = store.subscribe(() => {
      setAuthLoading(store.isAuthLoading());
      setCurrentUser(auth.currentUser);
      setCanAccess(store.canAccessApp());
    });

    return () => {
      unsubAuth();
      unsubStore();
    };
  }, []);

  // 1. Initial Authentication Resolution
  if (authLoading) {
    return <LoadingAuthenticationScreen />;
  }

  // 2. Signed-Out State
  if (!currentUser) {
    return <SignInScreen />;
  }

  // 3. Authenticated but Unauthorized State (or missing subscription entitlement)
  if (!canAccess) {
    return (
      <AccessDeniedScreen
        onAccessGranted={() => {
          setCanAccess(store.canAccessApp());
        }}
      />
    );
  }

  // 4. Authorized State: Mount full Recipe Calculator
  return <AuthorizedRecipeCalculatorApp />;
}
