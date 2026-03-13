import '@/global.css';

import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { HeroUINativeProvider } from 'heroui-native';
import { PortalHost } from 'heroui-native/portal';
import React from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import {
  AppearancePreferenceProvider,
  useAppearancePreference,
} from '@/context/appearance-preference-context';
import { AuthProvider, useAuth } from '@/context/auth-context';
import { MobileIntlFallbackProvider, MobileIntlProvider } from '@/context/mobile-i18n-context';
import { NetworkProvider } from '@/context/network-context';
import { PermissionsProvider } from '@/context/permissions-context';
import { RecipeFiltersProvider } from '@/context/recipe-filters-context';
import { RecipesProvider } from '@/context/recipes-context';
import { UserProvider } from '@/context/user-context';
import { useBackendBaseUrl } from '@/hooks/use-backend-base-url';
import { useCacheHydration } from '@/hooks/use-cache-hydration';
import { useCacheInvalidationOnReconnect } from '@/hooks/use-cache-lifecycle';
import { useMutationMessageResolver } from '@/hooks/use-mutation-message-resolver';
import { useSessionRevalidation } from '@/hooks/use-session-revalidation';
import { TrpcProvider } from '@/providers/trpc-provider';

// ============================================================================
// Root layout — entry point
// ============================================================================
//
// Provider hierarchy (outermost → innermost):
//
//   GestureHandlerRootView
//   └─ HeroUINativeProvider           (heroui-native theme primitives)
//      └─ AppearancePreferenceProvider (light / dark / system preference)
//         └─ ThemeProvider             (react-navigation theme)
//            └─ NetworkProvider        (reachability & health checks)
//               └─ TrpcProvider        (tRPC client, WebSocket, QueryClient)
//                  └─ AuthProvider     (session & sign-out)
//                     └─ MobileIntlProvider  (locale, handles auth/unauth internally)
//                        └─ DomainProviders  (permissions, user, recipes — auth only)
//
// Boot sequence gates (RootLayoutContent renders null until all resolve):
//   1. Appearance preference hydrated from MMKV
//   2. Backend base URL loaded from storage
//   3. Persisted query cache restored
//

// ============================================================================
// Entry point
// ============================================================================

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <HeroUINativeProvider>
        <AppearancePreferenceProvider>
          <RootLayoutContent />
        </AppearancePreferenceProvider>
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}

// ============================================================================
// Boot gate — waits for hydration, then renders provider tree
// ============================================================================

function RootLayoutContent() {
  const { hydrated, mode } = useAppearancePreference();
  const systemColorScheme = useColorScheme();

  const backendBaseUrl = useBackendBaseUrl();
  const cacheReady = useCacheHydration();

  // Gate: wait for all async hydration before rendering anything
  if (!hydrated || backendBaseUrl === undefined || !cacheReady) {
    return null;
  }

  const effectiveScheme =
    mode === 'system' ? (systemColorScheme ?? 'light') : mode;

  const theme = effectiveScheme === 'dark' ? DarkTheme : DefaultTheme;

  // No backend URL configured — minimal provider tree (setup / onboarding)
  if (!backendBaseUrl) {
    return (
      <ThemeProvider value={theme}>
        <AuthProvider backendBaseUrl={null}>
          <MobileIntlFallbackProvider>
            <RootStack />
            <PortalHost name="app" />
          </MobileIntlFallbackProvider>
        </AuthProvider>
      </ThemeProvider>
    );
  }

  // Full provider tree — backend available
  return (
    <ThemeProvider value={theme}>
      <NetworkProvider backendBaseUrl={backendBaseUrl}>
        <TrpcProvider baseUrl={backendBaseUrl}>
          <AuthProvider backendBaseUrl={backendBaseUrl}>
            <MobileIntlProvider>
              <IntlBoundaryEffects />
              <DomainProviders>
                <RootStack />
                <PortalHost name="app" />
              </DomainProviders>
            </MobileIntlProvider>
          </AuthProvider>
        </TrpcProvider>
      </NetworkProvider>
    </ThemeProvider>
  );
}

// ============================================================================
// Domain providers — added only when authenticated
// ============================================================================

/**
 * When authenticated, wraps children with domain-specific providers
 * (permissions, user, recipes, filters). When unauthenticated, renders
 * children directly.
 */
function DomainProviders({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return children;
  }

  return <AuthenticatedProviders>{children}</AuthenticatedProviders>;
}

function AuthenticatedProviders({ children }: { children: React.ReactNode }) {
  useCacheInvalidationOnReconnect();
  useSessionRevalidation();

  return (
    <RecipeFiltersProvider>
      <PermissionsProvider>
        <UserProvider>
          <RecipesProvider>
            {children}
          </RecipesProvider>
        </UserProvider>
      </PermissionsProvider>
    </RecipeFiltersProvider>
  );
}

/** Side-effects that require useIntl() — runs inside MobileIntlProvider. */
function IntlBoundaryEffects() {
  useMutationMessageResolver();
  return null;
}

// ============================================================================
// Navigation
// ============================================================================

function RootStack() {
  const { isAuthenticated } = useAuth();

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={isAuthenticated}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={!isAuthenticated}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

// ============================================================================

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
