// src/utils/currency.js
export const getCurrencySymbol = (currencyCode) => {
  const symbols = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
    KES: 'Ksh',
    NGN: '₦',
    GHS: '₵',
    ZAR: 'R',
    // Add more currencies as needed
  };
  return symbols[currencyCode] || currencyCode;
};

export const formatPrice = (price, currency) => {
  const symbol = getCurrencySymbol(currency);
  return `${symbol}${parseFloat(price).toFixed(2)}`;
};