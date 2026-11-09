import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

export default function TabOneScreen() {
  const colors = useColors();

  return (
    <ScrollView
      contentContainerStyle={[
        styles.container,
        { backgroundColor: colors.background },
      ]}
    >
      <View
        style={[
          styles.hero,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <View style={[styles.iconWrap, { backgroundColor: colors.primary }]}>
          <Feather name="book-open" size={28} color={colors.primaryForeground} />
        </View>
        <Text style={[styles.eyebrow, { color: colors.primary }]}>
          SỔ CÔNG · MOBILE
        </Text>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Nền tảng di động đã sẵn sàng
        </Text>
        <Text style={[styles.text, { color: colors.mutedForeground }]}>
          Đây là bộ khung Expo ban đầu. Cấu hình ký ứng dụng cục bộ đã được
          tách khỏi mã nguồn; các chức năng nghiệp vụ trên điện thoại có thể
          được bổ sung tiếp theo.
        </Text>
      </View>

      <View style={styles.details}>
        <View style={[styles.detailRow, { borderColor: colors.border }]}>
          <Feather name="shield" size={19} color={colors.primary} />
          <View style={styles.detailCopy}>
            <Text style={[styles.detailTitle, { color: colors.foreground }]}>
              Khóa ký nằm ngoài Git
            </Text>
            <Text style={[styles.detailText, { color: colors.mutedForeground }]}>
              Tệp credentials và chứng thư cục bộ được loại khỏi Git và gói triển khai.
            </Text>
          </View>
        </View>
        <View style={[styles.detailRow, { borderColor: colors.border }]}>
          <Feather name="settings" size={19} color={colors.primary} />
          <View style={styles.detailCopy}>
            <Text style={[styles.detailTitle, { color: colors.foreground }]}>
              Cấu hình EAS theo máy
            </Text>
            <Text style={[styles.detailText, { color: colors.mutedForeground }]}>
              Thông tin thật được điền trong tệp cục bộ, không lưu trong giao diện ứng dụng.
            </Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 22,
    paddingTop: 32,
    paddingBottom: 118,
    gap: 16,
  },
  hero: {
    alignItems: 'flex-start',
    padding: 22,
    borderWidth: 1,
    borderRadius: 24,
    gap: 12,
  },
  iconWrap: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    marginBottom: 8,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.3,
  },
  title: {
    fontSize: 29,
    lineHeight: 35,
    fontWeight: '800',
  },
  text: {
    fontSize: 15,
    lineHeight: 23,
  },
  details: {
    gap: 10,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 13,
    padding: 16,
    borderWidth: 1,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.58)',
  },
  detailCopy: {
    flex: 1,
    gap: 4,
  },
  detailTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  detailText: {
    fontSize: 13,
    lineHeight: 19,
  },
});
