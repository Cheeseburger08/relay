export const phoneNumberPattern = /^\+?[0-9][0-9 ()-]*$/;
export const isPhoneNumber = value => typeof value === "string" && value.length <= 40 && phoneNumberPattern.test(value);
