import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('expo-image', () => {
  const { View } = require('react-native');
  return { Image: (props) => <View testID="img" uri={props.source?.uri} /> };
});
jest.mock('@expo/vector-icons', () => {
  const { View } = require('react-native');
  return { MaterialCommunityIcons: () => <View testID="icon" /> };
});

const PlaylistCover = require('../PlaylistCover').default;
const uris = (r) => r.queryAllByTestId('img').map((n) => n.props.uri);

test('its own cover wins over the collage', () => {
  expect(uris(render(<PlaylistCover cover="own.jpg" images={['a', 'b']} />))).toEqual(['own.jpg']);
});

test('one song cover fills it; two to four make a 2x2 with blanks', () => {
  expect(uris(render(<PlaylistCover images={['a']} />))).toEqual(['a']);
  expect(uris(render(<PlaylistCover images={['a', 'b', 'c']} />))).toEqual(['a', 'b', 'c']);
});

test('no covers at all: the music icon', () => {
  const r = render(<PlaylistCover images={[]} />);
  expect(r.queryAllByTestId('img')).toHaveLength(0);
  expect(r.getByTestId('icon')).toBeTruthy();
});
