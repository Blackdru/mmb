/**
 * Utility functions for handling numbers and currency formatting
 */

/**
 * Safely convert a value to a number with proper decimal handling
 * @param {any} value - The value to convert
 * @param {number} defaultValue - Default value if conversion fails
 * @param {number} decimalPlaces - Number of decimal places to round to
 * @returns {number} - Properly formatted number
 */
function safeNumber(value, defaultValue = 0, decimalPlaces = 2) {
  try {
    // Handle null, undefined, empty string
    if (value === null || value === undefined || value === '') {
      return defaultValue;
    }

    // Handle Prisma Decimal objects
    if (value && typeof value === 'object' && value.toNumber) {
      return Math.round(value.toNumber() * Math.pow(10, decimalPlaces)) / Math.pow(10, decimalPlaces);
    }

    // Convert to number
    const num = Number(value);
    
    // Check if it's a valid number
    if (isNaN(num) || !isFinite(num)) {
      return defaultValue;
    }

    // Round to specified decimal places to avoid floating point issues
    return Math.round(num * Math.pow(10, decimalPlaces)) / Math.pow(10, decimalPlaces);
  } catch (error) {
    console.error('Error in safeNumber conversion:', error);
    return defaultValue;
  }
}

/**
 * Format a number as currency (Indian Rupees)
 * @param {any} amount - The amount to format
 * @param {boolean} showSymbol - Whether to show the ₹ symbol
 * @param {number} decimalPlaces - Number of decimal places
 * @returns {string} - Formatted currency string
 */
function formatCurrency(amount, showSymbol = true, decimalPlaces = 2) {
  const num = safeNumber(amount, 0, decimalPlaces);
  const formatted = num.toFixed(decimalPlaces);
  return showSymbol ? `₹${formatted}` : formatted;
}

/**
 * Format a number with Indian number system (lakhs, crores)
 * @param {any} amount - The amount to format
 * @param {boolean} showSymbol - Whether to show the ₹ symbol
 * @returns {string} - Formatted number string
 */
function formatIndianCurrency(amount, showSymbol = true) {
  const num = safeNumber(amount, 0);
  
  if (num >= 10000000) { // 1 crore
    return `${showSymbol ? '₹' : ''}${(num / 10000000).toFixed(2)}Cr`;
  } else if (num >= 100000) { // 1 lakh
    return `${showSymbol ? '₹' : ''}${(num / 100000).toFixed(2)}L`;
  } else if (num >= 1000) { // 1 thousand
    return `${showSymbol ? '₹' : ''}${(num / 1000).toFixed(1)}K`;
  } else {
    return formatCurrency(num, showSymbol);
  }
}

/**
 * Validate if a value is a valid monetary amount
 * @param {any} value - The value to validate
 * @param {number} minAmount - Minimum allowed amount
 * @param {number} maxAmount - Maximum allowed amount
 * @returns {object} - Validation result with isValid and message
 */
function validateAmount(value, minAmount = 0, maxAmount = Infinity) {
  const num = safeNumber(value, NaN);
  
  if (isNaN(num)) {
    return { isValid: false, message: 'Invalid amount format' };
  }
  
  if (num < minAmount) {
    return { isValid: false, message: `Minimum amount is ${formatCurrency(minAmount)}` };
  }
  
  if (num > maxAmount) {
    return { isValid: false, message: `Maximum amount is ${formatCurrency(maxAmount)}` };
  }
  
  return { isValid: true, amount: num };
}

/**
 * Calculate percentage with proper rounding
 * @param {any} part - The part value
 * @param {any} total - The total value
 * @param {number} decimalPlaces - Number of decimal places
 * @returns {number} - Percentage value
 */
function calculatePercentage(part, total, decimalPlaces = 2) {
  const partNum = safeNumber(part, 0);
  const totalNum = safeNumber(total, 0);
  
  if (totalNum === 0) return 0;
  
  const percentage = (partNum / totalNum) * 100;
  return safeNumber(percentage, 0, decimalPlaces);
}

/**
 * Add two monetary amounts safely
 * @param {any} amount1 - First amount
 * @param {any} amount2 - Second amount
 * @returns {number} - Sum of amounts
 */
function addAmounts(amount1, amount2) {
  const num1 = safeNumber(amount1, 0);
  const num2 = safeNumber(amount2, 0);
  return safeNumber(num1 + num2);
}

/**
 * Subtract two monetary amounts safely
 * @param {any} amount1 - First amount (minuend)
 * @param {any} amount2 - Second amount (subtrahend)
 * @returns {number} - Difference of amounts
 */
function subtractAmounts(amount1, amount2) {
  const num1 = safeNumber(amount1, 0);
  const num2 = safeNumber(amount2, 0);
  return safeNumber(num1 - num2);
}

/**
 * Convert amount to paise (for payment gateways)
 * @param {any} amount - Amount in rupees
 * @returns {number} - Amount in paise
 */
function toPaise(amount) {
  const num = safeNumber(amount, 0);
  return Math.round(num * 100);
}

/**
 * Convert amount from paise to rupees
 * @param {any} paise - Amount in paise
 * @returns {number} - Amount in rupees
 */
function fromPaise(paise) {
  const num = safeNumber(paise, 0);
  return safeNumber(num / 100);
}

module.exports = {
  safeNumber,
  formatCurrency,
  formatIndianCurrency,
  validateAmount,
  calculatePercentage,
  addAmounts,
  subtractAmounts,
  toPaise,
  fromPaise
};