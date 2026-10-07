import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import ReportModal from '../ReportModal';

jest.mock('../../services/api', () => ({ reportContent: jest.fn(async () => ({})) }));
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: (k) => k }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 34 }) }));

const api = require('../../services/api');

test('the serious reasons are offered first, and sent as they are', async () => {
  const screen = render(<ReportModal visible onClose={() => {}} contentType="story" objectId={7} />);
  for (const key of ['child_safety', 'self_harm', 'harassment', 'scam', 'impersonation', 'sexual']) {
    expect(screen.getByTestId(`report-reason-${key}`)).toBeTruthy();
  }
  fireEvent.press(screen.getByTestId('report-reason-child_safety'));
  await act(async () => { fireEvent.press(screen.getByTestId('report-submit')); });
  expect(api.reportContent).toHaveBeenCalledWith('story', 7, 'child_safety', '');
  expect(screen.getByText('report.thanks')).toBeTruthy();
});
