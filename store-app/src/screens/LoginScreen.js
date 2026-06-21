import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../context/AuthContext';
import { useLocale } from '../i18n';
import { Button, Field } from '../components/ui';
import { colors, radius, spacing } from '../theme';

export default function LoginScreen() {
  const { login } = useAuth();
  const { t, locale, setLocale } = useLocale();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async () => {
    if (!email.trim() || !password) {
      setError(t('requiredFields'));
      return;
    }
    setError('');
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (e) {
      setError(e.message || t('error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <Text style={styles.brandText}>
              <Text style={{ color: colors.accent }}>Arheb</Text> Store
            </Text>
            <Text style={styles.subtitle}>{t('loginSubtitle')}</Text>
          </View>

          <View style={styles.card}>
            <Field
              label={t('email')}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoCorrect={false}
              placeholder="store@arheb.com"
            />
            <Field
              label={t('password')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="••••••••"
            />
            {!!error && <Text style={styles.error}>{error}</Text>}
            <Button title={loading ? t('signingIn') : t('signIn')} onPress={onSubmit} loading={loading} />
          </View>

          <Pressable
            onPress={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
            style={styles.langToggle}
          >
            <Text style={styles.langText}>{locale === 'ar' ? 'English' : 'العربية'}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.ink },
  container: { flexGrow: 1, justifyContent: 'center', padding: spacing(3) },
  brand: { alignItems: 'center', marginBottom: spacing(4) },
  brandText: { fontSize: 32, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },
  subtitle: { color: '#cbd5e1', marginTop: spacing(1), fontSize: 14 },
  card: {
    backgroundColor: '#fff',
    borderRadius: radius.lg,
    padding: spacing(3),
  },
  error: { color: colors.danger, marginBottom: spacing(1.5), fontSize: 14 },
  langToggle: { alignSelf: 'center', marginTop: spacing(3), padding: spacing(1.5) },
  langText: { color: colors.accent, fontWeight: '700', fontSize: 15 },
});
