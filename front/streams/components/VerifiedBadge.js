// The verified-artist tick, beside a name. Set by an admin on the account.
import React from 'react';
import { MaterialIcons } from '@expo/vector-icons';

const VerifiedBadge = ({ size = 14, color = '#3AA8F2', style }) => (
  <MaterialIcons
    name="verified"
    size={size}
    color={color}
    style={style}
    accessibilityLabel="Verified artist"
  />
);

export default VerifiedBadge;
