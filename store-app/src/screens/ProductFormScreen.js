import React, { useEffect, useLayoutEffect, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import * as api from '../api';
import { useStore } from '../context/StoreContext';
import { useLocale } from '../i18n';
import { Button, Card, Field, Loader } from '../components/ui';
import { colors, radius, spacing } from '../theme';
import { uploadProductImage } from '../lib/firebaseUpload';

const EMPTY = {
  nameEn: '',
  nameAr: '',
  price: '',
  originalPrice: '',
  discount: '',
  stock: '',
  description: '',
  category: '',
  image: '',
  isAvailable: true,
};

export default function ProductFormScreen({ route, navigation }) {
  const { productId } = route.params || {};
  const isEdit = productId != null;
  const { store, storeId } = useStore();
  const { t } = useLocale();

  const [form, setForm] = useState(EMPTY);
  const [localImage, setLocalImage] = useState(null);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ title: isEdit ? t('editProduct') : t('addProduct') });
  }, [navigation, isEdit, t]);

  useEffect(() => {
    if (!isEdit || !storeId) return;
    let active = true;
    (async () => {
      try {
        const res = await api.getStoreProducts(storeId);
        const list = res.data?.products || res.products || [];
        const p = list.find((x) => String(x.id) === String(productId));
        if (active && p) {
          setForm({
            nameEn: p.nameEn || p.name || '',
            nameAr: p.nameAr || '',
            price: p.price != null ? String(p.price) : '',
            originalPrice: p.originalPrice != null ? String(p.originalPrice) : '',
            discount: p.discount != null ? String(p.discount) : '',
            stock: p.stock != null ? String(p.stock) : '',
            description: p.description || '',
            category: p.category || p.categoryEn || '',
            image: p.image || '',
            isAvailable: p.isAvailable !== false,
          });
        }
      } catch (e) {
        Alert.alert(t('error'), e.message || t('error'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [isEdit, storeId, productId, t]);

  const setField = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('error'), 'Permission needed to pick an image');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (!result.canceled && result.assets?.[0]?.uri) {
      setLocalImage(result.assets[0].uri);
    }
  };

  const onSave = async () => {
    if (!form.nameEn.trim() || form.price === '' || Number.isNaN(Number(form.price))) {
      Alert.alert(t('error'), t('requiredFields'));
      return;
    }
    setSaving(true);
    try {
      let imageUrl = form.image || '';
      if (localImage) {
        const storeName = store?.nameEn || store?.name || 'Store';
        imageUrl = await uploadProductImage(localImage, storeName, form.nameEn || 'product');
      }
      const body = {
        nameEn: form.nameEn.trim(),
        nameAr: form.nameAr.trim(),
        name: form.nameEn.trim(),
        price: Number(form.price) || 0,
        originalPrice: form.originalPrice === '' ? 0 : Number(form.originalPrice) || 0,
        discount: form.discount === '' ? null : form.discount,
        stock: form.stock === '' ? 0 : parseInt(form.stock, 10) || 0,
        description: form.description,
        category: form.category,
        image: imageUrl,
        isAvailable: form.isAvailable,
      };
      if (isEdit) await api.updateProduct(storeId, productId, body);
      else await api.createProduct(storeId, body);
      Alert.alert(t('productSaved'), '', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (e) {
      Alert.alert(t('error'), e.message || t('error'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loader text={t('loading')} />;

  const previewUri = localImage || form.image;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing(2) }} keyboardShouldPersistTaps="handled">
      <Card>
        <Pressable onPress={pickImage} style={styles.imagePicker}>
          {previewUri ? (
            <Image source={{ uri: previewUri }} style={styles.image} />
          ) : (
            <Text style={styles.imageHint}>{t('pickImage')}</Text>
          )}
        </Pressable>
        {!!previewUri && (
          <Pressable onPress={pickImage}>
            <Text style={styles.changeImage}>{t('changeImage')}</Text>
          </Pressable>
        )}

        <Field label={`${t('nameEn')} *`} value={form.nameEn} onChangeText={(v) => setField('nameEn', v)} />
        <Field label={t('nameAr')} value={form.nameAr} onChangeText={(v) => setField('nameAr', v)} />
        <Field label={`${t('price')} *`} value={form.price} onChangeText={(v) => setField('price', v)} keyboardType="decimal-pad" />
        <Field label={t('originalPrice')} value={form.originalPrice} onChangeText={(v) => setField('originalPrice', v)} keyboardType="decimal-pad" hint={t('optional')} />
        <Field label={t('discount')} value={form.discount} onChangeText={(v) => setField('discount', v)} placeholder="10 or 10%" hint={t('optional')} />
        <Field label={t('stock')} value={form.stock} onChangeText={(v) => setField('stock', v)} keyboardType="number-pad" hint={t('optional')} />
        <Field label={t('category')} value={form.category} onChangeText={(v) => setField('category', v)} hint={t('optional')} />
        <Field label={t('description')} value={form.description} onChangeText={(v) => setField('description', v)} multiline numberOfLines={3} hint={t('optional')} />

        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>{t('available')}</Text>
          <Switch
            value={form.isAvailable}
            onValueChange={(v) => setField('isAvailable', v)}
            trackColor={{ true: colors.accent, false: '#d1d5db' }}
            thumbColor="#fff"
          />
        </View>

        <Button title={saving ? t('saving') : t('save')} loading={saving} onPress={onSave} style={{ marginTop: spacing(1) }} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  imagePicker: {
    width: '100%',
    aspectRatio: 1.6,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: '#d1d5db',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#f9fafb',
    marginBottom: spacing(1),
  },
  image: { width: '100%', height: '100%' },
  imageHint: { color: colors.subtext, fontSize: 14 },
  changeImage: { color: colors.info, fontSize: 13, marginBottom: spacing(2), textAlign: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing(1.5) },
  switchLabel: { fontSize: 16, color: colors.text, fontWeight: '600' },
});
