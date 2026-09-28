/** «+7 701 555 12 34» for Kazakh numbers (+7XXXXXXXXXX), as is otherwise */
export const formatPhone = (phone?: string | null) => {
  if (!phone) return "";
  const match = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return match ? `+7 ${match[1]} ${match[2]} ${match[3]} ${match[4]}` : phone;
};
