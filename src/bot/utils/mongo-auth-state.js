import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';

export async function useMongoDBAuthState(collection, accountId) {
  const writeData = async (data, key) => {
    const jsonStr = JSON.stringify(data, BufferJSON.replacer);
    await collection.updateOne(
      { accountId, key },
      { $set: { data: jsonStr, updatedAt: new Date() } },
      { upsert: true }
    );
  };

  const readData = async (key) => {
    try {
      const doc = await collection.findOne({ accountId, key });
      if (!doc?.data) return null;
      return JSON.parse(doc.data, BufferJSON.reviver);
    } catch (err) {
      return null;
    }
  };

  const removeData = async (key) => {
    try {
      await collection.deleteOne({ accountId, key });
    } catch (err) {}
  };

  // Load creds or initialize new ones
  let creds = await readData('creds');
  if (!creds) {
    creds = initAuthCreds();
    await writeData(creds, 'creds');
  }

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              tasks.push(value ? writeData(value, key) : removeData(key));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: async () => {
      await writeData(creds, 'creds');
    },
  };
}
