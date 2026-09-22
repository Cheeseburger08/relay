// Use the existing versioned deletion API so each removal syncs to the phone.
export async function deleteContacts(api, ids) {
  let completed = 0;
  for (const id of ids) {
    try {
      await api("/contacts/" + encodeURIComponent(id), { method: "DELETE" });
      completed++;
    } catch (error) {
      throw new Error(
        `Deleted ${completed} of ${ids.length} contacts. ${error.message} You can retry the remaining contacts.`,
      );
    }
  }
}
