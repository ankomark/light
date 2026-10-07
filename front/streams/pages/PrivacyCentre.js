// The Privacy Centre: what each privacy control does, with the way to it (the
// controls themselves live in Settings), and the policies — so it complements
// Settings rather than repeating its switches.
import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { useI18n } from '../context/I18nContext';
import { InfoScreen, Section, Tiles, Para } from '../components/info/InfoKit';

const PrivacyCentre = () => {
  const navigation = useNavigation();
  const { t } = useI18n();

  const tile = (icon, key, onPress) => ({
    icon, title: t(`privacyCentre.${key}`), sub: t(`privacyCentre.${key}Sub`), onPress, testID: `privacy-${key}`,
  });
  const legal = (docKey) => () => navigation.navigate('LegalPage', { docKey });
  // Straight to the part of Settings each tile is about (Settings searches
  // for the section's own title), not to the top of a long page.
  const settingsAt = (sectionKey) => () => navigation.navigate('Settings', { search: t(sectionKey) });

  return (
    <InfoScreen title={t('privacyCentre.title')} eyebrow={t('privacyCentre.eyebrow')}
      subtitle={t('privacyCentre.subtitle')} icon="shield-account-outline" testID="privacy-centre">
      <Para style={{ marginTop: 10, textAlign: 'center' }}>{t('privacyCentre.intro')}</Para>

      <Section label={t('privacyCentre.controlsLabel')} plain>
        <Tiles items={[
          tile('lock-outline', 'privateAccount', settingsAt('settings.section.privacy')),
          tile('account-cancel-outline', 'blocked', () => navigation.navigate('BlockedUsers')),
          tile('bell-outline', 'notifications', settingsAt('settings.section.notifications')),
          tile('account-remove-outline', 'account', settingsAt('settings.section.session')),
        ]} />
      </Section>

      <Section label={t('privacyCentre.policiesLabel')} plain>
        <Tiles items={[
          tile('shield-check-outline', 'privacyPolicy', legal('privacy')),
          tile('account-group-outline', 'guidelines', legal('guidelines')),
          tile('file-document-outline', 'terms', legal('terms')),
        ]} />
      </Section>

      <Section label={t('privacyCentre.helpLabel')} plain>
        <Tiles items={[
          { icon: 'lifebuoy', title: t('help.title'), sub: t('help.subtitle'), onPress: () => navigation.navigate('Help') },
        ]} />
      </Section>
    </InfoScreen>
  );
};

export default PrivacyCentre;
