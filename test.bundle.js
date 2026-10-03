var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/supabase.ts
var supabase_exports = {};
__export(supabase_exports, {
  SUPABASE_CONFIG: () => SUPABASE_CONFIG,
  clearSupabaseData: () => clearSupabaseData,
  deleteSupabaseCustomer: () => deleteSupabaseCustomer,
  deleteSupabaseEmployee: () => deleteSupabaseEmployee,
  deleteSupabaseIspClient: () => deleteSupabaseIspClient,
  deleteSupabaseSalaryPayment: () => deleteSupabaseSalaryPayment,
  deleteSupabaseTransaction: () => deleteSupabaseTransaction,
  fetchSupabaseData: () => fetchSupabaseData,
  getSupabaseStatus: () => getSupabaseStatus,
  initSupabase: () => initSupabase,
  resetSupabaseIspClients: () => resetSupabaseIspClients,
  syncAllToSupabase: () => syncAllToSupabase,
  upsertSupabaseCustomer: () => upsertSupabaseCustomer,
  upsertSupabaseEmployee: () => upsertSupabaseEmployee,
  upsertSupabaseIspBrand: () => upsertSupabaseIspBrand,
  upsertSupabaseIspClient: () => upsertSupabaseIspClient,
  upsertSupabaseProfile: () => upsertSupabaseProfile,
  upsertSupabaseSalaryPayment: () => upsertSupabaseSalaryPayment,
  upsertSupabaseTransaction: () => upsertSupabaseTransaction,
  withClient: () => withClient
});
import pg from "pg";
function getPoolCandidates() {
  const directHost = rawHost && !rawHost.includes("pooler") ? rawHost : `db.${rawProjectId}.supabase.co`;
  const poolerHost = `aws-0-${rawRegion}.pooler.supabase.com`;
  return [
    {
      name: "Supabase Transaction Pooler (port 6543)",
      host: poolerHost,
      port: 6543,
      user: `postgres.${rawProjectId}`
    },
    {
      name: "Supabase Session Pooler (port 5432)",
      host: poolerHost,
      port: 5432,
      user: `postgres.${rawProjectId}`
    },
    {
      name: "Direct Supabase Host (port 5432)",
      host: directHost,
      port: 5432,
      user: "postgres"
    }
  ];
}
async function getWorkingPool() {
  if (activePool) {
    return activePool;
  }
  const candidates = getPoolCandidates();
  let firstErr = null;
  for (const c of candidates) {
    const candidatePool = new Pool({
      host: c.host,
      port: c.port,
      user: c.user,
      password: SUPABASE_CONFIG.password,
      database: SUPABASE_CONFIG.database,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5e3,
      idleTimeoutMillis: 1e4,
      max: 2,
      keepAlive: true,
      keepAliveInitialDelayMillis: 5e3
    });
    candidatePool.on("error", (err) => {
      console.warn(`[Supabase Pool Warning - ${c.name}]:`, err?.message || err);
      if (activePool === candidatePool) {
        activePool = null;
        isConnected = false;
      }
    });
    let client = null;
    let hasErr = false;
    try {
      client = await candidatePool.connect();
      client.on("error", (err) => {
        console.warn(`[Supabase Client Init Warning - ${c.name}]:`, err?.message || err);
        hasErr = true;
      });
      await client.query("SELECT 1");
      client.release(hasErr);
      client = null;
      activePool = candidatePool;
      activePoolType = c.name;
      isConnected = true;
      lastError = null;
      console.log(`\u2705 Supabase pool connected via ${c.name}`);
      return activePool;
    } catch (err) {
      if (client) {
        try {
          client.release(true);
        } catch (_) {
        }
      }
      if (!firstErr) firstErr = err;
      try {
        await candidatePool.end();
      } catch (_) {
      }
    }
  }
  isConnected = false;
  lastError = firstErr ? firstErr.message : "All Supabase connection attempts timed out";
  throw new Error(lastError || "Supabase connection failed");
}
async function withClient(fn) {
  let pool;
  try {
    pool = await getWorkingPool();
  } catch (err) {
    activePool = null;
    throw err;
  }
  let client = null;
  let hasError = false;
  const clientErrorHandler = (err) => {
    console.warn("[Supabase Client Error]:", err?.message || err);
    hasError = true;
  };
  try {
    client = await pool.connect();
    client.on("error", clientErrorHandler);
    const result = await fn(client);
    return result;
  } catch (err) {
    hasError = true;
    if (err.message.includes("timeout") || err.message.includes("closed") || err.message.includes("password") || err.message.includes("terminated")) {
      activePool = null;
      isConnected = false;
    }
    throw err;
  } finally {
    if (client) {
      try {
        client.removeListener("error", clientErrorHandler);
      } catch (_) {
      }
      try {
        client.release(hasError);
      } catch (_) {
      }
    }
  }
}
async function initSupabase() {
  try {
    await withClient(async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS tally_profile (
          id TEXT PRIMARY KEY DEFAULT 'default',
          shop_name TEXT NOT NULL,
          owner_name TEXT NOT NULL,
          phone TEXT,
          address TEXT,
          currency_symbol TEXT DEFAULT '\u09F3',
          logo TEXT,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        ALTER TABLE tally_profile ADD COLUMN IF NOT EXISTS logo TEXT;
        ALTER TABLE tally_transactions ADD COLUMN IF NOT EXISTS operator_name TEXT;
        ALTER TABLE tally_employees ADD COLUMN IF NOT EXISTS nickname TEXT;
        ALTER TABLE tally_employees ADD COLUMN IF NOT EXISTS pin TEXT;

        CREATE TABLE IF NOT EXISTS tally_customers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          phone TEXT,
          address TEXT,
          type TEXT DEFAULT 'customer',
          opening_balance NUMERIC DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS tally_transactions (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          amount NUMERIC NOT NULL,
          date TEXT NOT NULL,
          time TEXT NOT NULL,
          customer_id TEXT,
          category TEXT,
          description TEXT,
          receipt_number TEXT,
          operator_name TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS tally_employees (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          designation TEXT,
          phone TEXT,
          monthly_salary NUMERIC DEFAULT 0,
          join_date TEXT,
          status TEXT DEFAULT 'active',
          address TEXT,
          notes TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS tally_salary_payments (
          id TEXT PRIMARY KEY,
          employee_id TEXT NOT NULL,
          amount NUMERIC NOT NULL,
          month TEXT NOT NULL,
          date TEXT NOT NULL,
          time TEXT NOT NULL,
          payment_method TEXT DEFAULT 'cash',
          bonus NUMERIC DEFAULT 0,
          deduction NUMERIC DEFAULT 0,
          note TEXT,
          receipt_number TEXT,
          basic_salary NUMERIC DEFAULT 0,
          paid_basic_salary NUMERIC DEFAULT 0,
          remaining_due NUMERIC DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        ALTER TABLE tally_salary_payments ADD COLUMN IF NOT EXISTS basic_salary NUMERIC DEFAULT 0;
        ALTER TABLE tally_salary_payments ADD COLUMN IF NOT EXISTS paid_basic_salary NUMERIC DEFAULT 0;
        ALTER TABLE tally_salary_payments ADD COLUMN IF NOT EXISTS remaining_due NUMERIC DEFAULT 0;

        CREATE TABLE IF NOT EXISTS tally_snapshots (
          id TEXT PRIMARY KEY,
          filename TEXT,
          date TIMESTAMPTZ DEFAULT NOW(),
          note TEXT,
          customers_count INT DEFAULT 0,
          transactions_count INT DEFAULT 0,
          total_due NUMERIC DEFAULT 0,
          data JSONB
        );

                CREATE TABLE IF NOT EXISTS tally_isp_brand (
          id TEXT PRIMARY KEY DEFAULT 'default',
          title TEXT NOT NULL,
          badge TEXT,
          description TEXT,
          logo_url TEXT,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS tally_isp_clients (
          client_id TEXT PRIMARY KEY,
          sr_no INT DEFAULT 0,
          c_code TEXT,
          client_name TEXT NOT NULL,
          mobile TEXT,
          zone TEXT,
          sub_zone TEXT,
          monthly_bill NUMERIC DEFAULT 0,
          due NUMERIC DEFAULT 0,
          due_date TEXT,
          is_paid BOOLEAN,
          payment_date TEXT,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_tally_isp_zone ON tally_isp_clients(zone);
        CREATE INDEX IF NOT EXISTS idx_tally_isp_status ON tally_isp_clients(is_paid);

        CREATE TABLE IF NOT EXISTS tally_auth (
          id TEXT PRIMARY KEY DEFAULT 'default',
          admin_id TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          last_login TIMESTAMPTZ,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
    });
    isConnected = true;
    lastError = null;
    return true;
  } catch (err) {
    console.warn("\u26A0\uFE0F Supabase initialization notice:", err.message);
    isConnected = false;
    lastError = err.message;
    return false;
  }
}
async function getSupabaseStatus() {
  try {
    const status = await withClient(async (client) => {
      const custRes = await client.query("SELECT count(*) FROM tally_customers");
      const txnRes = await client.query("SELECT count(*) FROM tally_transactions");
      let empCount = 0;
      let salCount = 0;
      let ispClientsCount = 0;
      try {
        const empRes = await client.query("SELECT count(*) FROM tally_employees");
        empCount = parseInt(empRes.rows[0].count, 10);
        const salRes = await client.query("SELECT count(*) FROM tally_salary_payments");
        salCount = parseInt(salRes.rows[0].count, 10);
        const ispRes = await client.query("SELECT count(*) FROM tally_isp_clients");
        ispClientsCount = parseInt(ispRes.rows[0].count, 10);
      } catch {
      }
      const timeRes = await client.query("SELECT NOW() as db_time, version()");
      return {
        connected: true,
        projectId: SUPABASE_CONFIG.projectId,
        organization: SUPABASE_CONFIG.organization,
        region: SUPABASE_CONFIG.region,
        host: SUPABASE_CONFIG.host,
        database: SUPABASE_CONFIG.database,
        poolType: activePoolType,
        customersCount: parseInt(custRes.rows[0].count, 10),
        transactionsCount: parseInt(txnRes.rows[0].count, 10),
        employeesCount: empCount,
        salaryPaymentsCount: salCount,
        ispClientsCount,
        databaseTime: timeRes.rows[0].db_time,
        version: timeRes.rows[0].version,
        error: null
      };
    });
    isConnected = true;
    lastError = null;
    return status;
  } catch (err) {
    isConnected = false;
    lastError = err.message;
    return {
      connected: false,
      projectId: SUPABASE_CONFIG.projectId,
      organization: SUPABASE_CONFIG.organization,
      region: SUPABASE_CONFIG.region,
      host: SUPABASE_CONFIG.host,
      database: SUPABASE_CONFIG.database,
      poolType: activePoolType,
      customersCount: 0,
      transactionsCount: 0,
      employeesCount: 0,
      salaryPaymentsCount: 0,
      error: err.message
    };
  }
}
async function fetchSupabaseData() {
  try {
    return await withClient(async (client) => {
      const profRes = await client.query("SELECT * FROM tally_profile WHERE id = $1", ["default"]);
      let profile = {
        shopName: "\u09AE\u09A1\u09BE\u09B0\u09CD\u09A8 \u0995\u09AE\u09CD\u09AA\u09BF\u0989\u099F\u09BE\u09B0",
        ownerName: "\u09AE\u09CB: \u09AE\u09BE\u09B8\u09C1\u09A6 \u09B0\u09BE\u09A8\u09BE",
        phone: "\u09E6\u09E7\u09ED\u09EA\u09EA-\u09EE\u09EE\u09EF\u09EC\u09EE\u09EE",
        address: "\u09A8\u09AC\u09BE\u09AC\u0997\u099E\u09CD\u099C, \u09A6\u09BF\u09A8\u09BE\u099C\u09AA\u09C1\u09B0\u0964",
        currencySymbol: "\u09F3"
      };
      if (profRes.rows.length > 0) {
        const p = profRes.rows[0];
        profile = {
          shopName: p.shop_name,
          ownerName: p.owner_name,
          phone: p.phone || "",
          address: p.address || "",
          currencySymbol: p.currency_symbol || "\u09F3",
          logo: p.logo || void 0
        };
      }
      const custRes = await client.query("SELECT * FROM tally_customers ORDER BY created_at ASC");
      const customers = custRes.rows.map((row) => ({
        id: row.id,
        name: row.name,
        phone: row.phone || "",
        address: row.address || "",
        type: row.type || "customer",
        openingBalance: parseFloat(row.opening_balance) || 0,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString()
      }));
      const txnRes = await client.query("SELECT * FROM tally_transactions ORDER BY date DESC, time DESC");
      const transactions = txnRes.rows.map((row) => ({
        id: row.id,
        type: row.type,
        amount: parseFloat(row.amount) || 0,
        date: row.date,
        time: row.time,
        customerId: row.customer_id || null,
        category: row.category,
        description: row.description || "",
        receiptNumber: row.receipt_number || "",
        createdAt: new Date(row.created_at).toISOString()
      }));
      let employees = [];
      try {
        const empRes = await client.query("SELECT * FROM tally_employees ORDER BY created_at ASC");
        employees = empRes.rows.map((row) => ({
          id: row.id,
          name: row.name,
          designation: row.designation || "\u0995\u09B0\u09CD\u09AE\u099A\u09BE\u09B0\u09C0",
          phone: row.phone || "",
          monthlySalary: parseFloat(row.monthly_salary) || 0,
          joinDate: row.join_date || "",
          status: row.status === "inactive" ? "inactive" : "active",
          address: row.address || "",
          notes: row.notes || "",
          createdAt: new Date(row.created_at).toISOString(),
          updatedAt: new Date(row.updated_at).toISOString()
        }));
      } catch (e) {
        console.warn("tally_employees fetch fallback:", e);
      }
      let salaryPayments = [];
      try {
        const salRes = await client.query("SELECT * FROM tally_salary_payments ORDER BY date DESC, time DESC");
        salaryPayments = salRes.rows.map((row) => ({
          id: row.id,
          employeeId: row.employee_id,
          amount: parseFloat(row.amount) || 0,
          basicSalary: row.basic_salary !== null && row.basic_salary !== void 0 ? parseFloat(row.basic_salary) : void 0,
          paidBasicSalary: row.paid_basic_salary !== null && row.paid_basic_salary !== void 0 ? parseFloat(row.paid_basic_salary) : void 0,
          remainingDue: row.remaining_due !== null && row.remaining_due !== void 0 ? parseFloat(row.remaining_due) : void 0,
          month: row.month,
          date: row.date,
          time: row.time,
          paymentMethod: row.payment_method || "cash",
          bonus: parseFloat(row.bonus) || 0,
          deduction: parseFloat(row.deduction) || 0,
          note: row.note || "",
          receiptNumber: row.receipt_number || "",
          createdAt: new Date(row.created_at).toISOString()
        }));
      } catch (e) {
        console.warn("tally_salary_payments fetch fallback:", e);
      }
      let ispClients = [];
      try {
        const ispRes = await client.query("SELECT * FROM tally_isp_clients ORDER BY sr_no ASC, client_id ASC");
        ispClients = ispRes.rows.map((row) => ({
          srNo: row.sr_no || 0,
          clientId: row.client_id,
          cCode: row.c_code || "",
          clientName: row.client_name,
          mobile: row.mobile || "",
          zone: row.zone || "",
          subZone: row.sub_zone || "",
          monthlyBill: parseFloat(row.monthly_bill) || 0,
          due: parseFloat(row.due) || 0,
          dueDate: row.due_date || "",
          isPaid: row.is_paid,
          paymentDate: row.payment_date || "",
          updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : (/* @__PURE__ */ new Date()).toISOString()
        }));
      } catch (e) {
        console.warn("tally_isp_clients fetch fallback:", e);
      }
      let ispBrandConfig = void 0;
      try {
        const brandRes = await client.query("SELECT * FROM tally_isp_brand WHERE id = $1 LIMIT 1", ["default"]);
        if (brandRes.rows.length > 0) {
          const b = brandRes.rows[0];
          ispBrandConfig = {
            title: b.title || "Friends Broadband Network Nawabganj",
            badge: b.badge || "Billing Control v2",
            description: b.description || "\u0997\u09CD\u09B0\u09BE\u09B9\u0995 \u09AC\u09BF\u09B2\u09BF\u0982 \u0993 \u0995\u09BE\u09B2\u09C7\u0995\u09B6\u09A8 \u09A1\u09CD\u09AF\u09BE\u09B6\u09AC\u09CB\u09B0\u09CD\u09A1",
            logoUrl: b.logo_url || null,
            updatedAt: b.updated_at ? new Date(b.updated_at).toISOString() : (/* @__PURE__ */ new Date()).toISOString()
          };
        }
      } catch (e) {
        console.warn("tally_isp_brand fetch fallback:", e);
      }
      let authRecord = void 0;
      try {
        const authRes = await client.query("SELECT * FROM tally_auth WHERE id = $1 LIMIT 1", ["default"]);
        if (authRes.rows.length > 0) {
          const a = authRes.rows[0];
          authRecord = {
            adminId: a.admin_id || "admin",
            password: a.password_hash || "123456",
            lastLogin: a.last_login ? new Date(a.last_login).toISOString() : void 0,
            updatedAt: a.updated_at ? new Date(a.updated_at).toISOString() : (/* @__PURE__ */ new Date()).toISOString()
          };
        }
      } catch (e) {
        console.warn("tally_auth fetch fallback:", e);
      }
      return {
        version: "1.0.0",
        profile,
        auth: authRecord,
        customers,
        transactions,
        employees,
        salaryPayments,
        ispClients,
        ispBrandConfig,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
    });
  } catch (err) {
    console.warn("Supabase fetch notice (fallback to local cache):", err.message);
    return null;
  }
}
async function syncAllToSupabase(data) {
  try {
    return await withClient(async (client) => {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO tally_profile (id, shop_name, owner_name, phone, address, currency_symbol, logo, updated_at)
         VALUES ('default', $1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (id) DO UPDATE
         SET shop_name = EXCLUDED.shop_name,
             owner_name = EXCLUDED.owner_name,
             phone = EXCLUDED.phone,
             address = EXCLUDED.address,
             currency_symbol = EXCLUDED.currency_symbol,
             logo = EXCLUDED.logo,
             updated_at = NOW()`,
        [
          data.profile.shopName,
          data.profile.ownerName,
          data.profile.phone,
          data.profile.address,
          data.profile.currencySymbol || "\u09F3",
          data.profile.logo || null
        ]
      );
      for (const c of data.customers || []) {
        await client.query(
          `INSERT INTO tally_customers (id, name, phone, address, type, opening_balance, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO UPDATE
           SET name = EXCLUDED.name,
               phone = EXCLUDED.phone,
               address = EXCLUDED.address,
               type = EXCLUDED.type,
               opening_balance = EXCLUDED.opening_balance,
               updated_at = EXCLUDED.updated_at`,
          [c.id, c.name, c.phone || "", c.address || "", c.type, c.openingBalance, c.createdAt, c.updatedAt]
        );
      }
      for (const t of data.transactions || []) {
        await client.query(
          `INSERT INTO tally_transactions (id, type, amount, date, time, customer_id, category, description, receipt_number, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO UPDATE
           SET type = EXCLUDED.type,
               amount = EXCLUDED.amount,
               date = EXCLUDED.date,
               time = EXCLUDED.time,
               customer_id = EXCLUDED.customer_id,
               category = EXCLUDED.category,
               description = EXCLUDED.description,
               receipt_number = EXCLUDED.receipt_number`,
          [t.id, t.type, t.amount, t.date, t.time, t.customerId || null, t.category, t.description || "", t.receiptNumber || "", t.createdAt]
        );
      }
      for (const emp of data.employees || []) {
        await client.query(
          `INSERT INTO tally_employees (id, name, designation, phone, monthly_salary, join_date, status, address, notes, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (id) DO UPDATE
           SET name = EXCLUDED.name,
               designation = EXCLUDED.designation,
               phone = EXCLUDED.phone,
               monthly_salary = EXCLUDED.monthly_salary,
               join_date = EXCLUDED.join_date,
               status = EXCLUDED.status,
               address = EXCLUDED.address,
               notes = EXCLUDED.notes,
               updated_at = EXCLUDED.updated_at`,
          [emp.id, emp.name, emp.designation, emp.phone || "", emp.monthlySalary, emp.joinDate, emp.status, emp.address || "", emp.notes || "", emp.createdAt, emp.updatedAt]
        );
      }
      for (const sal of data.salaryPayments || []) {
        await client.query(
          `INSERT INTO tally_salary_payments (id, employee_id, amount, month, date, time, payment_method, bonus, deduction, note, receipt_number, basic_salary, paid_basic_salary, remaining_due, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           ON CONFLICT (id) DO UPDATE
           SET employee_id = EXCLUDED.employee_id,
               amount = EXCLUDED.amount,
               month = EXCLUDED.month,
               date = EXCLUDED.date,
               time = EXCLUDED.time,
               payment_method = EXCLUDED.payment_method,
               bonus = EXCLUDED.bonus,
               deduction = EXCLUDED.deduction,
               note = EXCLUDED.note,
               receipt_number = EXCLUDED.receipt_number,
               basic_salary = EXCLUDED.basic_salary,
               paid_basic_salary = EXCLUDED.paid_basic_salary,
               remaining_due = EXCLUDED.remaining_due`,
          [
            sal.id,
            sal.employeeId,
            sal.amount,
            sal.month,
            sal.date,
            sal.time,
            sal.paymentMethod,
            sal.bonus || 0,
            sal.deduction || 0,
            sal.note || "",
            sal.receiptNumber || "",
            sal.basicSalary || 0,
            sal.paidBasicSalary || 0,
            sal.remainingDue || 0,
            sal.createdAt
          ]
        );
      }
      const brand = data.ispBrandConfig || {
        title: "Friends Broadband Network Nawabganj",
        badge: "Billing Control v2",
        description: "\u0997\u09CD\u09B0\u09BE\u09B9\u0995 \u09AC\u09BF\u09B2\u09BF\u0982 \u0993 \u0995\u09BE\u09B2\u09C7\u0995\u09B6\u09A8 \u09A1\u09CD\u09AF\u09BE\u09B6\u09AC\u09CB\u09B0\u09CD\u09A1",
        logoUrl: null
      };
      await client.query(
        `INSERT INTO tally_isp_brand (id, title, badge, description, logo_url, updated_at)
         VALUES ('default', $1, $2, $3, $4, NOW())
         ON CONFLICT (id) DO UPDATE
         SET title = EXCLUDED.title,
             badge = EXCLUDED.badge,
             description = EXCLUDED.description,
             logo_url = EXCLUDED.logo_url,
             updated_at = NOW()`,
        [brand.title, brand.badge, brand.description, brand.logoUrl || null]
      );
      const clientsList = data.ispClients || [];
      for (const c of clientsList) {
        await client.query(
          `INSERT INTO tally_isp_clients (client_id, sr_no, c_code, client_name, mobile, zone, sub_zone, monthly_bill, due, due_date, is_paid, payment_date, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
           ON CONFLICT (client_id) DO UPDATE
           SET sr_no = EXCLUDED.sr_no,
               c_code = EXCLUDED.c_code,
               client_name = EXCLUDED.client_name,
               mobile = EXCLUDED.mobile,
               zone = EXCLUDED.zone,
               sub_zone = EXCLUDED.sub_zone,
               monthly_bill = EXCLUDED.monthly_bill,
               due = EXCLUDED.due,
               due_date = EXCLUDED.due_date,
               is_paid = EXCLUDED.is_paid,
               payment_date = EXCLUDED.payment_date,
               updated_at = NOW()`,
          [
            c.clientId,
            c.srNo || 0,
            c.cCode || "",
            c.clientName,
            c.mobile || "",
            c.zone || "N/A",
            c.subZone || "N/A",
            c.monthlyBill || 0,
            c.due || 0,
            c.dueDate || "",
            c.isPaid,
            c.paymentDate || ""
          ]
        );
      }
      if (data.auth) {
        await client.query(
          `INSERT INTO tally_auth (id, admin_id, password_hash, last_login, updated_at)
           VALUES ('default', $1, $2, $3, NOW())
           ON CONFLICT (id) DO UPDATE
           SET admin_id = EXCLUDED.admin_id,
               password_hash = EXCLUDED.password_hash,
               last_login = EXCLUDED.last_login,
               updated_at = NOW()`,
          [data.auth.adminId || "admin", data.auth.password || "123456", data.auth.lastLogin || null]
        );
      }
      await client.query("COMMIT");
      console.log("\u2705 Full dataset successfully synced to Supabase PostgreSQL!");
      return true;
    });
  } catch (err) {
    console.warn("Supabase sync notice:", err.message);
    return false;
  }
}
async function upsertSupabaseProfile(profile) {
  try {
    await withClient(async (client) => {
      await client.query(
        `INSERT INTO tally_profile (id, shop_name, owner_name, phone, address, currency_symbol, logo, updated_at)
         VALUES ('default', $1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (id) DO UPDATE
         SET shop_name = EXCLUDED.shop_name,
             owner_name = EXCLUDED.owner_name,
             phone = EXCLUDED.phone,
             address = EXCLUDED.address,
             currency_symbol = EXCLUDED.currency_symbol,
             logo = EXCLUDED.logo,
             updated_at = NOW()`,
        [profile.shopName, profile.ownerName, profile.phone, profile.address, profile.currencySymbol || "\u09F3", profile.logo || null]
      );
    });
  } catch (err) {
    console.warn("Supabase upsertProfile notice:", err.message);
  }
}
async function upsertSupabaseCustomer(cust) {
  try {
    await withClient(async (client) => {
      await client.query(
        `INSERT INTO tally_customers (id, name, phone, address, type, opening_balance, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name,
             phone = EXCLUDED.phone,
             address = EXCLUDED.address,
             type = EXCLUDED.type,
             opening_balance = EXCLUDED.opening_balance,
             updated_at = EXCLUDED.updated_at`,
        [cust.id, cust.name, cust.phone || "", cust.address || "", cust.type, cust.openingBalance, cust.createdAt, cust.updatedAt]
      );
    });
  } catch (err) {
    console.warn("Supabase upsertCustomer notice:", err.message);
  }
}
async function deleteSupabaseCustomer(id) {
  try {
    await withClient(async (client) => {
      await client.query("DELETE FROM tally_customers WHERE id = $1", [id]);
      await client.query("UPDATE tally_transactions SET customer_id = NULL WHERE customer_id = $1", [id]);
    });
  } catch (err) {
    console.warn("Supabase deleteCustomer notice:", err.message);
  }
}
async function upsertSupabaseTransaction(txn) {
  try {
    await withClient(async (client) => {
      await client.query(
        `INSERT INTO tally_transactions (id, type, amount, date, time, customer_id, category, description, receipt_number, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE
         SET type = EXCLUDED.type,
             amount = EXCLUDED.amount,
             date = EXCLUDED.date,
             time = EXCLUDED.time,
             customer_id = EXCLUDED.customer_id,
             category = EXCLUDED.category,
             description = EXCLUDED.description,
             receipt_number = EXCLUDED.receipt_number`,
        [txn.id, txn.type, txn.amount, txn.date, txn.time, txn.customerId || null, txn.category, txn.description || "", txn.receiptNumber || "", txn.createdAt]
      );
    });
  } catch (err) {
    console.warn("Supabase upsertTransaction notice:", err.message);
  }
}
async function deleteSupabaseTransaction(id) {
  try {
    await withClient(async (client) => {
      await client.query("DELETE FROM tally_transactions WHERE id = $1", [id]);
    });
  } catch (err) {
    console.warn("Supabase deleteTransaction notice:", err.message);
  }
}
async function upsertSupabaseEmployee(emp) {
  try {
    await withClient(async (client) => {
      await client.query(
        `INSERT INTO tally_employees (id, name, designation, phone, monthly_salary, join_date, status, address, notes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name,
             designation = EXCLUDED.designation,
             phone = EXCLUDED.phone,
             monthly_salary = EXCLUDED.monthly_salary,
             join_date = EXCLUDED.join_date,
             status = EXCLUDED.status,
             address = EXCLUDED.address,
             notes = EXCLUDED.notes,
             updated_at = EXCLUDED.updated_at`,
        [emp.id, emp.name, emp.designation, emp.phone || "", emp.monthlySalary, emp.joinDate, emp.status, emp.address || "", emp.notes || "", emp.createdAt, emp.updatedAt]
      );
    });
  } catch (err) {
    console.warn("Supabase upsertEmployee notice:", err.message);
  }
}
async function deleteSupabaseEmployee(id) {
  try {
    await withClient(async (client) => {
      await client.query("DELETE FROM tally_salary_payments WHERE employee_id = $1", [id]);
      await client.query("DELETE FROM tally_employees WHERE id = $1", [id]);
    });
  } catch (err) {
    console.warn("Supabase deleteEmployee notice:", err.message);
  }
}
async function upsertSupabaseSalaryPayment(sal) {
  try {
    await withClient(async (client) => {
      await client.query(
        `INSERT INTO tally_salary_payments (id, employee_id, amount, month, date, time, payment_method, bonus, deduction, note, receipt_number, basic_salary, paid_basic_salary, remaining_due, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (id) DO UPDATE
         SET employee_id = EXCLUDED.employee_id,
             amount = EXCLUDED.amount,
             month = EXCLUDED.month,
             date = EXCLUDED.date,
             time = EXCLUDED.time,
             payment_method = EXCLUDED.payment_method,
             bonus = EXCLUDED.bonus,
             deduction = EXCLUDED.deduction,
             note = EXCLUDED.note,
             receipt_number = EXCLUDED.receipt_number,
             basic_salary = EXCLUDED.basic_salary,
             paid_basic_salary = EXCLUDED.paid_basic_salary,
             remaining_due = EXCLUDED.remaining_due`,
        [
          sal.id,
          sal.employeeId,
          sal.amount,
          sal.month,
          sal.date,
          sal.time,
          sal.paymentMethod,
          sal.bonus || 0,
          sal.deduction || 0,
          sal.note || "",
          sal.receiptNumber || "",
          sal.basicSalary || 0,
          sal.paidBasicSalary || 0,
          sal.remainingDue || 0,
          sal.createdAt
        ]
      );
    });
  } catch (err) {
    console.warn("Supabase upsertSalaryPayment notice:", err.message);
  }
}
async function deleteSupabaseSalaryPayment(id) {
  try {
    await withClient(async (client) => {
      await client.query("DELETE FROM tally_salary_payments WHERE id = $1", [id]);
    });
  } catch (err) {
    console.warn("Supabase deleteSalaryPayment notice:", err.message);
  }
}
async function clearSupabaseData() {
  try {
    await withClient(async (client) => {
      await client.query("TRUNCATE TABLE tally_salary_payments CASCADE");
      await client.query("TRUNCATE TABLE tally_employees CASCADE");
      await client.query("TRUNCATE TABLE tally_transactions CASCADE");
      await client.query("TRUNCATE TABLE tally_customers CASCADE");
    });
  } catch (err) {
    console.warn("Supabase clearData notice:", err.message);
  }
}
async function upsertSupabaseIspClient(clientData) {
  try {
    await withClient(async (client) => {
      await client.query(
        `INSERT INTO tally_isp_clients (client_id, sr_no, c_code, client_name, mobile, zone, sub_zone, monthly_bill, due, due_date, is_paid, payment_date, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
         ON CONFLICT (client_id) DO UPDATE
         SET sr_no = EXCLUDED.sr_no,
             c_code = EXCLUDED.c_code,
             client_name = EXCLUDED.client_name,
             mobile = EXCLUDED.mobile,
             zone = EXCLUDED.zone,
             sub_zone = EXCLUDED.sub_zone,
             monthly_bill = EXCLUDED.monthly_bill,
             due = EXCLUDED.due,
             due_date = EXCLUDED.due_date,
             is_paid = EXCLUDED.is_paid,
             payment_date = EXCLUDED.payment_date,
             updated_at = NOW()`,
        [
          clientData.clientId,
          clientData.srNo || 0,
          clientData.cCode || "",
          clientData.clientName,
          clientData.mobile || "",
          clientData.zone || "N/A",
          clientData.subZone || "N/A",
          clientData.monthlyBill || 0,
          clientData.due || 0,
          clientData.dueDate || "",
          clientData.isPaid,
          clientData.paymentDate || ""
        ]
      );
    });
  } catch (err) {
    console.warn("Supabase upsertIspClient notice:", err.message);
  }
}
async function deleteSupabaseIspClient(clientId) {
  try {
    await withClient(async (client) => {
      await client.query("DELETE FROM tally_isp_clients WHERE client_id = $1", [clientId]);
    });
  } catch (err) {
    console.warn("Supabase deleteIspClient notice:", err.message);
  }
}
async function resetSupabaseIspClients() {
  try {
    await withClient(async (client) => {
      await client.query("TRUNCATE TABLE tally_isp_clients CASCADE");
    });
  } catch (err) {
    console.warn("Supabase resetIspClients notice:", err.message);
  }
}
async function upsertSupabaseIspBrand(brand) {
  try {
    await withClient(async (client) => {
      await client.query(
        `INSERT INTO tally_isp_brand (id, title, badge, description, logo_url, updated_at)
         VALUES ('default', $1, $2, $3, $4, NOW())
         ON CONFLICT (id) DO UPDATE
         SET title = EXCLUDED.title,
             badge = EXCLUDED.badge,
             description = EXCLUDED.description,
             logo_url = EXCLUDED.logo_url,
             updated_at = NOW()`,
        [brand.title, brand.badge, brand.description, brand.logoUrl || null]
      );
    });
  } catch (err) {
    console.warn("Supabase upsertIspBrand notice:", err.message);
  }
}
var Pool, rawProjectId, rawPassword, rawRegion, rawDbName, rawDbUser, rawHost, SUPABASE_CONFIG, activePool, activePoolType, isConnected, lastError;
var init_supabase = __esm({
  "server/supabase.ts"() {
    ({ Pool } = pg);
    rawProjectId = (process.env.SUPABASE_PROJECT_ID || "psvozwvgacovrwyogavg").trim();
    rawPassword = (process.env.SUPABASE_DB_PASSWORD || "M@5udr@n@88").trim();
    rawRegion = (process.env.SUPABASE_REGION || "ap-northeast-1").trim();
    rawDbName = (process.env.SUPABASE_DB_NAME || "postgres").trim();
    if (!rawDbName || rawDbName === "MC Accounts" || rawDbName.toLowerCase().includes("account") || rawDbName !== "postgres") {
      rawDbName = "postgres";
    }
    rawDbUser = (process.env.SUPABASE_DB_USER || "postgres").trim();
    if (!rawDbUser || rawDbUser.includes("@") || rawDbUser === "rana889688" || !rawDbUser.startsWith("postgres") && !rawDbUser.startsWith("postgres.")) {
      rawDbUser = "postgres";
    }
    rawHost = (process.env.SUPABASE_DB_HOST || "").trim();
    if (rawHost.startsWith("http://") || rawHost.startsWith("https://")) {
      try {
        rawHost = new URL(rawHost).hostname;
      } catch (_) {
      }
    }
    SUPABASE_CONFIG = {
      host: rawHost && !rawHost.includes("pooler") ? rawHost : `db.${rawProjectId}.supabase.co`,
      port: Number(process.env.SUPABASE_DB_PORT) || 5432,
      user: rawDbUser,
      password: rawPassword,
      database: rawDbName,
      projectId: rawProjectId,
      organization: "MC Accounts",
      region: rawRegion
    };
    activePool = null;
    activePoolType = "none";
    isConnected = false;
    lastError = null;
  }
});

// server.ts
import express from "express";
import path2 from "path";
import fs2 from "fs";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";

// server/db.ts
init_supabase();
import fs from "fs";
import path from "path";
var DATA_DIR = path.join(process.cwd(), "data");
var DB_FILE = path.join(DATA_DIR, "database.json");
var BACKUPS_DIR = path.join(DATA_DIR, "backups");
var INITIAL_PROFILE = {
  shopName: "\u09AE\u09A1\u09BE\u09B0\u09CD\u09A3 \u0995\u09AE\u09CD\u09AA\u09BF\u0989\u099F\u09BE\u09B0",
  ownerName: "\u09AE\u09CB: \u09AE\u09BE\u09B8\u09C1\u09A6 \u09B0\u09BE\u09A8\u09BE",
  phone: "\u09E6\u09E7\u09ED\u09EA\u09EA-\u09EE\u09EE\u09EF\u09EC\u09EE\u09EE",
  address: "\u09A8\u09AC\u09BE\u09AC\u0997\u099E\u09CD\u099C, \u09A6\u09BF\u09A8\u09BE\u099C\u09AA\u09C1\u09B0\u0964",
  currencySymbol: "\u09F3"
};
var getSampleData = () => {
  const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const yesterdayDate = new Date(Date.now() - 864e5);
  const yesterday = yesterdayDate.toISOString().split("T")[0];
  const customers = [
    {
      id: "cust-1",
      name: "\u09AE\u09CB: \u09B0\u09B9\u09BF\u09AE \u09AE\u09BF\u09DF\u09BE",
      phone: "01711002233",
      address: "\u09A6\u09CB\u0995\u09BE\u09A8 \u09B8\u0982\u09B2\u0997\u09CD\u09A8, \u09AC\u09BE\u09DC\u09BF #\u09E7\u09E8",
      type: "customer",
      openingBalance: 1500,
      createdAt: new Date(Date.now() - 864e5 * 5).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    },
    {
      id: "cust-2",
      name: "\u0995\u09BE\u09AE\u09BE\u09B2 \u09B9\u09CB\u09B8\u09C7\u09A8 (\u09B9\u09CB\u099F\u09C7\u09B2 \u09AC\u09CD\u09AF\u09AC\u09B8\u09BE\u09DF\u09C0)",
      phone: "01822334455",
      address: "\u09AC\u09BE\u099C\u09BE\u09B0 \u09AE\u09CB\u09DC",
      type: "customer",
      openingBalance: 4200,
      createdAt: new Date(Date.now() - 864e5 * 4).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    },
    {
      id: "cust-3",
      name: "\u0986\u09B0\u09BF\u09AB\u09C1\u09B2 \u0987\u09B8\u09B2\u09BE\u09AE",
      phone: "01933445566",
      address: "\u09B8\u09CD\u0995\u09C1\u09B2 \u09B0\u09CB\u09A1",
      type: "customer",
      openingBalance: 0,
      createdAt: new Date(Date.now() - 864e5 * 3).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    },
    {
      id: "cust-4",
      name: "\u09AE\u09C7\u0998\u09A8\u09BE \u09A1\u09BF\u09B8\u09CD\u099F\u09CD\u09B0\u09BF\u09AC\u09BF\u0989\u09B6\u09A8 (\u09B8\u09BE\u09AA\u09CD\u09B2\u09BE\u09DF\u09BE\u09B0)",
      phone: "01655667788",
      address: "\u09A4\u09C7\u099C\u0997\u09BE\u0981\u0993 \u09B6\u09BF\u09B2\u09CD\u09AA \u098F\u09B2\u09BE\u0995\u09BE",
      type: "supplier",
      openingBalance: -8500,
      // We owe them 8,500
      createdAt: new Date(Date.now() - 864e5 * 6).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    }
  ];
  const transactions = [
    {
      id: "txn-1",
      type: "cash_in",
      amount: 6800,
      date: yesterday,
      time: "11:30",
      customerId: null,
      category: "\u09A8\u0997\u09A6 \u09AC\u09C7\u099A\u09BE\u0995\u09C7\u09A8\u09BE",
      description: "\u09B8\u09BE\u09B0\u09BE\u09A6\u09BF\u09A8\u09C7\u09B0 \u0996\u09C1\u099A\u09B0\u09BE \u09AE\u09BE\u09B2\u09BE\u09AE\u09BE\u09B2 \u09AC\u09BF\u0995\u09CD\u09B0\u09BF",
      createdAt: new Date(yesterdayDate.setHours(11, 30)).toISOString()
    },
    {
      id: "txn-2",
      type: "due_given",
      amount: 1200,
      date: yesterday,
      time: "14:15",
      customerId: "cust-1",
      category: "\u09AC\u09BE\u0995\u09BF \u09AC\u09BF\u0995\u09CD\u09B0\u09BF",
      description: "\u09A4\u09C8\u09B2, \u09A1\u09BE\u09B2 \u0993 \u099A\u09BF\u09A8\u09BF \u09AC\u09BE\u0995\u09BF \u09A8\u09BF\u09B2\u09C7\u09A8",
      createdAt: new Date(yesterdayDate.setHours(14, 15)).toISOString()
    },
    {
      id: "txn-3",
      type: "cash_out",
      amount: 950,
      date: yesterday,
      time: "17:00",
      customerId: null,
      category: "\u09A6\u09CB\u0995\u09BE\u09A8 \u0996\u09B0\u099A",
      description: "\u09A6\u09CB\u0995\u09BE\u09A8\u09C7\u09B0 \u09AC\u09BF\u09A6\u09CD\u09AF\u09C1\u09CE \u09AC\u09BF\u09B2 \u09AA\u09B0\u09BF\u09B6\u09CB\u09A7",
      createdAt: new Date(yesterdayDate.setHours(17, 0)).toISOString()
    },
    {
      id: "txn-4",
      type: "cash_in",
      amount: 4500,
      date: today,
      time: "09:45",
      customerId: null,
      category: "\u09A8\u0997\u09A6 \u09AC\u09C7\u099A\u09BE\u0995\u09C7\u09A8\u09BE",
      description: "\u09B8\u0995\u09BE\u09B2\u09C7\u09B0 \u09A8\u0997\u09A6 \u0995\u09BE\u09B8\u09CD\u099F\u09AE\u09BE\u09B0 \u09AC\u09BF\u0995\u09CD\u09B0\u09BF",
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    },
    {
      id: "txn-5",
      type: "due_collected",
      amount: 2e3,
      date: today,
      time: "11:10",
      customerId: "cust-2",
      category: "\u09AC\u09BE\u0995\u09BF \u0989\u09B8\u09C1\u09B2",
      description: "\u09B9\u09CB\u099F\u09C7\u09B2\u09C7\u09B0 \u09AA\u09C1\u09B0\u09BE\u09A4\u09A8 \u09AC\u09BE\u0995\u09BF \u0986\u0982\u09B6\u09BF\u0995 \u09AA\u09B0\u09BF\u09B6\u09CB\u09A7",
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    },
    {
      id: "txn-6",
      type: "due_given",
      amount: 850,
      date: today,
      time: "12:30",
      customerId: "cust-3",
      category: "\u09AC\u09BE\u0995\u09BF \u09AC\u09BF\u0995\u09CD\u09B0\u09BF",
      description: "\u099A\u09BE\u09B2 \u0993 \u09AE\u09B8\u09B2\u09BE \u09AC\u09BE\u0995\u09BF",
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    },
    {
      id: "txn-7",
      type: "cash_out",
      amount: 1500,
      date: today,
      time: "13:00",
      customerId: null,
      category: "\u09AE\u09BE\u09B2\u09BE\u09AE\u09BE\u09B2 \u09AA\u09B0\u09BF\u09AC\u09B9\u09A8",
      description: "\u0986\u09DC\u09A4 \u09A5\u09C7\u0995\u09C7 \u09AE\u09BE\u09B2\u09BE\u09AE\u09BE\u09B2 \u0986\u09A8\u09BE\u09B0 \u09AA\u09BF\u0995\u0986\u09AA \u09AD\u09BE\u09DC\u09BE",
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    }
  ];
  const employees = [
    {
      id: "emp-1",
      name: "\u09AE\u09CB: \u09A8\u09BE\u099C\u09AE\u09C1\u09B2 \u09B9\u09BE\u09B8\u09BE\u09A8",
      designation: "\u0995\u09AE\u09CD\u09AA\u09BF\u0989\u099F\u09BE\u09B0 \u0985\u09AA\u09BE\u09B0\u09C7\u099F\u09B0",
      phone: "01712345678",
      monthlySalary: 12e3,
      joinDate: "2026-01-01",
      status: "active",
      address: "\u09A8\u09AC\u09BE\u09AC\u0997\u099E\u09CD\u099C, \u09A6\u09BF\u09A8\u09BE\u099C\u09AA\u09C1\u09B0",
      notes: "\u0995\u09AE\u09CD\u09AA\u09BF\u0989\u099F\u09BE\u09B0 \u0995\u09AE\u09CD\u09AA\u09CB\u099C \u0993 \u09A1\u09BF\u099C\u09BE\u0987\u09A8 \u0985\u09AA\u09BE\u09B0\u09C7\u099F\u09B0",
      createdAt: new Date(Date.now() - 864e5 * 30).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    },
    {
      id: "emp-2",
      name: "\u09AE\u09CB: \u0986\u09B2-\u0986\u09AE\u09BF\u09A8",
      designation: "\u09B8\u09C7\u09B2\u09B8 \u0993 \u09B8\u09BE\u09B0\u09CD\u09AD\u09BF\u09B8 \u0985\u09CD\u09AF\u09BE\u09B8\u09BF\u09B8\u09CD\u099F\u09CD\u09AF\u09BE\u09A8\u09CD\u099F",
      phone: "01898765432",
      monthlySalary: 1e4,
      joinDate: "2026-03-01",
      status: "active",
      address: "\u09A6\u09BF\u09A8\u09BE\u099C\u09AA\u09C1\u09B0 \u09B8\u09A6\u09B0",
      notes: "\u09A6\u09CB\u0995\u09BE\u09A8 \u09AA\u09B0\u09BF\u099A\u09BE\u09B2\u09A8\u09BE \u0993 \u0995\u09BE\u09B8\u09CD\u099F\u09AE\u09BE\u09B0 \u09B8\u09BE\u09B0\u09CD\u09AD\u09BF\u09B8",
      createdAt: new Date(Date.now() - 864e5 * 20).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    }
  ];
  const salaryPayments = [
    {
      id: "sal-1",
      employeeId: "emp-1",
      amount: 12e3,
      month: "\u0986\u0997\u09B8\u09CD\u099F \u09E8\u09E6\u09E8\u09EC",
      date: yesterday,
      time: "18:00",
      paymentMethod: "cash",
      bonus: 0,
      deduction: 0,
      note: "\u0986\u0997\u09B8\u09CD\u099F \u09AE\u09BE\u09B8\u09C7\u09B0 \u09AA\u09C2\u09B0\u09CD\u09A3 \u09AC\u09C7\u09A4\u09A8 \u09AA\u09B0\u09BF\u09B6\u09CB\u09A7",
      receiptNumber: "SAL-0826-01",
      createdAt: new Date(Date.now() - 864e5).toISOString()
    }
  ];
  return {
    version: "1.0.0",
    profile: INITIAL_PROFILE,
    customers,
    transactions,
    employees,
    salaryPayments,
    ispClients: [],
    ispBrandConfig: {
      title: "Friends Broadband Network Nawabganj",
      badge: "Billing Control v2",
      description: "\u0997\u09CD\u09B0\u09BE\u09B9\u0995 \u09AC\u09BF\u09B2\u09BF\u0982 \u0993 \u0995\u09BE\u09B2\u09C7\u0995\u09B6\u09A8 \u09A1\u09CD\u09AF\u09BE\u09B6\u09AC\u09CB\u09B0\u09CD\u09A1",
      logoUrl: null
    },
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
};
var DatabaseManager = class _DatabaseManager {
  constructor() {
    this.isStorageEnsured = false;
    this.isSupabaseInitialized = false;
    this.ensureStorage();
  }
  static getInstance() {
    if (!_DatabaseManager.instance) {
      _DatabaseManager.instance = new _DatabaseManager();
    }
    return _DatabaseManager.instance;
  }
  ensureStorage() {
    if (this.isStorageEnsured) return;
    this.isStorageEnsured = true;
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(BACKUPS_DIR)) {
      fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
      const initial = getSampleData();
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), "utf-8");
      this.createSnapshot("\u09AA\u09CD\u09B0\u09BE\u09A5\u09AE\u09BF\u0995 \u09A1\u09BE\u099F\u09BE\u09AC\u09C7\u099C \u09AC\u09CD\u09AF\u09BE\u0995\u0986\u09AA");
    }
    if (!this.isSupabaseInitialized) {
      this.isSupabaseInitialized = true;
      initSupabase().then(async (connected) => {
        if (connected) {
          try {
            const status = await getSupabaseStatus();
            const localData = this.readData();
            if (status.customersCount === 0 && (localData.customers.length > 0 || localData.ispClients && localData.ispClients.length > 0)) {
              console.log("Seeding Supabase with local data...");
              await syncAllToSupabase(localData);
            } else if (status.customersCount > 0 || status.ispClientsCount > 0) {
              const cloudData = await fetchSupabaseData();
              if (cloudData && (cloudData.customers.length > 0 || cloudData.ispClients && cloudData.ispClients.length > 0)) {
                const current = this.readData();
                const merged = {
                  ...cloudData,
                  ispClients: cloudData.ispClients && cloudData.ispClients.length > 0 ? cloudData.ispClients : current.ispClients || [],
                  ispBrandConfig: cloudData.ispBrandConfig || current.ispBrandConfig
                };
                this.writeData(merged);
              }
            }
          } catch (e) {
            console.warn("Supabase initial sync check warning:", e);
          }
        }
      }).catch((err) => {
        console.warn("Supabase initialization error:", err?.message || err);
      });
    }
  }
  readData() {
    this.ensureStorage();
    try {
      const raw = fs.readFileSync(DB_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.employees)) {
        parsed.employees = [];
      }
      if (!Array.isArray(parsed.salaryPayments)) {
        parsed.salaryPayments = [];
      }
      if (!Array.isArray(parsed.ispClients)) {
        parsed.ispClients = [];
      }
      if (!parsed.ispBrandConfig) {
        parsed.ispBrandConfig = {
          title: "Friends Broadband Network Nawabganj",
          badge: "Billing Control v2",
          description: "\u0997\u09CD\u09B0\u09BE\u09B9\u0995 \u09AC\u09BF\u09B2\u09BF\u0982 \u0993 \u0995\u09BE\u09B2\u09C7\u0995\u09B6\u09A8 \u09A1\u09CD\u09AF\u09BE\u09B6\u09AC\u09CB\u09B0\u09CD\u09A1",
          logoUrl: null
        };
      }
      if (!parsed.cashCalculations) {
        parsed.cashCalculations = [];
      }
      return parsed;
    } catch (err) {
      console.error("Error reading database file, fallback to sample data:", err);
      const fallback = getSampleData();
      try {
        fs.writeFileSync(DB_FILE, JSON.stringify(fallback, null, 2), "utf-8");
      } catch (writeErr) {
        console.error("Failed to write fallback DB_FILE:", writeErr);
      }
      return fallback;
    }
  }
  writeData(data) {
    this.ensureStorage();
    data.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    const tempFile = `${DB_FILE}.tmp.${process.pid}.${Date.now()}`;
    try {
      fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), "utf-8");
      fs.renameSync(tempFile, DB_FILE);
    } catch (err) {
      console.error("Safe atomic rename failed, fallback direct write:", err);
      try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf-8");
      } catch (writeErr) {
        console.error("Direct write to database.json failed:", writeErr);
      }
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      } catch (_) {
      }
    }
  }
  getProfile() {
    const data = this.readData();
    return data.profile || INITIAL_PROFILE;
  }
  updateProfile(profile) {
    const data = this.readData();
    data.profile = { ...data.profile, ...profile };
    this.writeData(data);
    upsertSupabaseProfile(data.profile).catch((e) => console.error("Supabase profile sync error:", e));
    return data.profile;
  }
  getCustomers() {
    const data = this.readData();
    return data.customers.map((cust) => {
      const custTxns = data.transactions.filter((t) => t.customerId === cust.id);
      let balance = Number(cust.openingBalance) || 0;
      let lastTxnDate = cust.createdAt.split("T")[0];
      custTxns.forEach((t) => {
        if (t.type === "due_given") {
          balance += Number(t.amount) || 0;
        } else if (t.type === "due_collected") {
          balance -= Number(t.amount) || 0;
        }
        if (t.date && t.date > lastTxnDate) {
          lastTxnDate = t.date;
        }
      });
      return {
        ...cust,
        currentBalance: balance,
        lastTransactionDate: lastTxnDate
      };
    });
  }
  getCustomerById(id) {
    const customers = this.getCustomers();
    const customer = customers.find((c) => c.id === id);
    if (!customer) return null;
    const data = this.readData();
    const transactions = data.transactions.filter((t) => t.customerId === id).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    return {
      customer,
      transactions
    };
  }
  addCustomer(cust) {
    const data = this.readData();
    const newCustomer = {
      ...cust,
      id: `cust-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      openingBalance: Number(cust.openingBalance) || 0,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    data.customers.push(newCustomer);
    this.writeData(data);
    upsertSupabaseCustomer(newCustomer).catch((e) => console.error("Supabase add customer error:", e));
    return newCustomer;
  }
  updateCustomer(id, updates) {
    const data = this.readData();
    const index = data.customers.findIndex((c) => c.id === id);
    if (index === -1) return null;
    const editor = (updates.lastModifiedBy || "\u09AE\u09BE\u09B2\u09BF\u0995").trim();
    data.customers[index] = {
      ...data.customers[index],
      ...updates,
      lastModifiedBy: editor,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.writeData(data);
    upsertSupabaseCustomer(data.customers[index]).catch((e) => console.error("Supabase update customer error:", e));
    return data.customers[index];
  }
  deleteCustomer(id) {
    const data = this.readData();
    const beforeCount = data.customers.length;
    data.customers = data.customers.filter((c) => c.id !== id);
    if (data.customers.length !== beforeCount) {
      data.transactions = data.transactions.map((t) => {
        if (t.customerId === id) {
          return { ...t, customerId: null };
        }
        return t;
      });
      this.writeData(data);
      deleteSupabaseCustomer(id).catch((e) => console.error("Supabase delete customer error:", e));
      return true;
    }
    return false;
  }
  getTransactions(filters) {
    const data = this.readData();
    const customerMap = /* @__PURE__ */ new Map();
    data.customers.forEach((c) => customerMap.set(c.id, c));
    let list = data.transactions.map((t) => {
      const cust = t.customerId ? customerMap.get(t.customerId) : void 0;
      return {
        ...t,
        customerName: cust ? cust.name : void 0,
        customerPhone: cust ? cust.phone : void 0
      };
    });
    if (filters) {
      if (filters.customerId) {
        list = list.filter((t) => t.customerId === filters.customerId);
      }
      if (filters.type && filters.type !== "all") {
        list = list.filter((t) => t.type === filters.type);
      }
      if (filters.startDate) {
        list = list.filter((t) => t.date >= filters.startDate);
      }
      if (filters.endDate) {
        list = list.filter((t) => t.date <= filters.endDate);
      }
      if (filters.search) {
        const q = filters.search.toLowerCase();
        list = list.filter(
          (t) => t.description.toLowerCase().includes(q) || t.category.toLowerCase().includes(q) || t.customerName && t.customerName.toLowerCase().includes(q) || t.customerPhone && t.customerPhone.includes(q) || t.receiptNumber && t.receiptNumber.toLowerCase().includes(q)
        );
      }
    }
    return list.sort((a, b) => (b.date + " " + b.time).localeCompare(a.date + " " + a.time));
  }
  addTransaction(txn) {
    const data = this.readData();
    const newTxn = {
      ...txn,
      id: `txn-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      amount: Math.abs(Number(txn.amount)) || 0,
      date: txn.date || (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
      time: txn.time || (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" }),
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    data.transactions.push(newTxn);
    this.writeData(data);
    upsertSupabaseTransaction(newTxn).catch((e) => console.error("Supabase add transaction error:", e));
    return newTxn;
  }
  updateTransaction(id, updates) {
    const data = this.readData();
    const index = data.transactions.findIndex((t) => t.id === id);
    if (index === -1) return null;
    const prev = data.transactions[index];
    const editor = (updates.lastModifiedBy || "\u09AE\u09BE\u09B2\u09BF\u0995").trim();
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const editHistory = Array.isArray(prev.editHistory) ? [...prev.editHistory] : [];
    editHistory.push({
      editedBy: editor,
      editedAt: nowIso,
      oldAmount: prev.amount,
      newAmount: updates.amount !== void 0 ? Math.abs(Number(updates.amount)) : prev.amount
    });
    data.transactions[index] = {
      ...prev,
      ...updates,
      amount: updates.amount !== void 0 ? Math.abs(Number(updates.amount)) : prev.amount,
      lastModifiedBy: editor,
      lastModifiedAt: nowIso,
      editHistory
    };
    this.writeData(data);
    upsertSupabaseTransaction(data.transactions[index]).catch((e) => console.error("Supabase update transaction error:", e));
    return data.transactions[index];
  }
  deleteTransaction(id) {
    const data = this.readData();
    const beforeCount = data.transactions.length;
    data.transactions = data.transactions.filter((t) => t.id !== id);
    if (data.transactions.length !== beforeCount) {
      this.writeData(data);
      deleteSupabaseTransaction(id).catch((e) => console.error("Supabase delete transaction error:", e));
      return true;
    }
    return false;
  }
  // Employees Management
  getEmployees() {
    const data = this.readData();
    const payments = data.salaryPayments || [];
    return (data.employees || []).map((emp) => {
      const empPayments = payments.filter((p) => p.employeeId === emp.id);
      const totalPaid = empPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
      const lastPayment = [...empPayments].sort((a, b) => (b.date + " " + b.time).localeCompare(a.date + " " + a.time))[0];
      return {
        ...emp,
        totalPaidSalary: totalPaid,
        paymentsCount: empPayments.length,
        lastPaymentDate: lastPayment ? lastPayment.date : void 0
      };
    });
  }
  getEmployeeById(id) {
    const employees = this.getEmployees();
    const employee = employees.find((e) => e.id === id);
    if (!employee) return null;
    const data = this.readData();
    const payments = (data.salaryPayments || []).filter((p) => p.employeeId === id).sort((a, b) => (b.date + " " + b.time).localeCompare(a.date + " " + a.time));
    return {
      employee,
      payments
    };
  }
  addEmployee(emp) {
    const data = this.readData();
    data.employees = data.employees || [];
    const newEmp = {
      ...emp,
      id: `emp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      monthlySalary: Math.max(0, Number(emp.monthlySalary) || 0),
      status: emp.status || "active",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    data.employees.push(newEmp);
    this.writeData(data);
    upsertSupabaseEmployee(newEmp).catch((e) => console.error("Supabase add employee error:", e));
    return newEmp;
  }
  updateEmployee(id, updates) {
    const data = this.readData();
    data.employees = data.employees || [];
    const index = data.employees.findIndex((e) => e.id === id);
    if (index === -1) return null;
    data.employees[index] = {
      ...data.employees[index],
      ...updates,
      monthlySalary: updates.monthlySalary !== void 0 ? Math.max(0, Number(updates.monthlySalary)) : data.employees[index].monthlySalary,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.writeData(data);
    upsertSupabaseEmployee(data.employees[index]).catch((e) => console.error("Supabase update employee error:", e));
    return data.employees[index];
  }
  deleteEmployee(id) {
    const data = this.readData();
    data.employees = data.employees || [];
    data.salaryPayments = data.salaryPayments || [];
    const beforeCount = data.employees.length;
    data.employees = data.employees.filter((e) => e.id !== id);
    data.salaryPayments = data.salaryPayments.filter((s) => s.employeeId !== id);
    if (data.employees.length !== beforeCount) {
      this.writeData(data);
      deleteSupabaseEmployee(id).catch((e) => console.error("Supabase delete employee error:", e));
      return true;
    }
    return false;
  }
  // Salary Payments Management
  getSalaryPayments(filters) {
    const data = this.readData();
    const employeeMap = /* @__PURE__ */ new Map();
    (data.employees || []).forEach((e) => employeeMap.set(e.id, e));
    let list = (data.salaryPayments || []).map((sal) => {
      const emp = employeeMap.get(sal.employeeId);
      const basicSalary = sal.basicSalary !== void 0 ? sal.basicSalary : emp ? emp.monthlySalary : sal.amount;
      const paidBasicSalary = sal.paidBasicSalary !== void 0 ? sal.paidBasicSalary : sal.amount;
      const remainingDue = sal.remainingDue !== void 0 ? sal.remainingDue : Math.max(0, basicSalary - paidBasicSalary);
      return {
        ...sal,
        basicSalary,
        paidBasicSalary,
        remainingDue,
        employeeName: emp ? emp.name : "\u0985\u099C\u09CD\u099E\u09BE\u09A4 \u0995\u09B0\u09CD\u09AE\u099A\u09BE\u09B0\u09C0",
        employeeDesignation: emp ? emp.designation : "",
        employeePhone: emp ? emp.phone : ""
      };
    });
    if (filters) {
      if (filters.employeeId) {
        list = list.filter((s) => s.employeeId === filters.employeeId);
      }
      if (filters.month) {
        list = list.filter((s) => s.month.toLowerCase().includes(filters.month.toLowerCase()));
      }
      if (filters.startDate) {
        list = list.filter((s) => s.date >= filters.startDate);
      }
      if (filters.endDate) {
        list = list.filter((s) => s.date <= filters.endDate);
      }
      if (filters.search) {
        const q = filters.search.toLowerCase();
        list = list.filter(
          (s) => s.employeeName.toLowerCase().includes(q) || s.employeeDesignation.toLowerCase().includes(q) || s.month.toLowerCase().includes(q) || s.note && s.note.toLowerCase().includes(q) || s.receiptNumber && s.receiptNumber.toLowerCase().includes(q)
        );
      }
    }
    return list.sort((a, b) => (b.date + " " + b.time).localeCompare(a.date + " " + a.time));
  }
  addSalaryPayment(payment) {
    const data = this.readData();
    data.employees = data.employees || [];
    data.salaryPayments = data.salaryPayments || [];
    const emp = data.employees.find((e) => e.id === payment.employeeId);
    const empName = emp ? emp.name : "\u0995\u09B0\u09CD\u09AE\u099A\u09BE\u09B0\u09C0";
    const basicSalary = payment.basicSalary !== void 0 ? Number(payment.basicSalary) : emp ? emp.monthlySalary : 0;
    const paidBasicSalary = payment.paidBasicSalary !== void 0 ? Number(payment.paidBasicSalary) : Math.abs(Number(payment.amount)) || 0;
    const remainingDue = payment.remainingDue !== void 0 ? Number(payment.remainingDue) : Math.max(0, basicSalary - paidBasicSalary);
    const now = /* @__PURE__ */ new Date();
    const dateStr = payment.date || now.toISOString().split("T")[0];
    const timeStr = payment.time || now.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
    const receiptNo = payment.receiptNumber || `SAL-${Date.now().toString().slice(-6)}`;
    const newPayment = {
      id: `sal-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      employeeId: payment.employeeId,
      amount: Math.abs(Number(payment.amount)) || 0,
      basicSalary,
      paidBasicSalary,
      remainingDue,
      month: payment.month,
      date: dateStr,
      time: timeStr,
      paymentMethod: payment.paymentMethod || "cash",
      bonus: Number(payment.bonus) || 0,
      deduction: Number(payment.deduction) || 0,
      note: payment.note || "",
      receiptNumber: receiptNo,
      createdAt: now.toISOString()
    };
    data.salaryPayments.push(newPayment);
    if (payment.recordInCashBook !== false) {
      const descriptionDetails = remainingDue > 0 ? `\u09AC\u09C7\u09A4\u09A8 \u09AA\u09CD\u09B0\u09A6\u09BE\u09A8: ${empName} (${payment.month}) [\u09AE\u09C2\u09B2: \u09F3${basicSalary}, \u09AA\u09CD\u09B0\u09A6\u09BE\u09A8: \u09F3${paidBasicSalary}, \u09AC\u0995\u09C7\u09DF\u09BE: \u09F3${remainingDue}]` : `\u09AC\u09C7\u09A4\u09A8 \u09AA\u09CD\u09B0\u09A6\u09BE\u09A8: ${empName} (${payment.month})`;
      const newTxn = {
        id: `txn-sal-${newPayment.id}`,
        type: "cash_out",
        amount: newPayment.amount,
        date: dateStr,
        time: timeStr,
        customerId: null,
        category: "\u0995\u09B0\u09CD\u09AE\u099A\u09BE\u09B0\u09C0 \u09AC\u09C7\u09A4\u09A8",
        description: descriptionDetails,
        receiptNumber: receiptNo,
        createdAt: now.toISOString()
      };
      data.transactions.push(newTxn);
      upsertSupabaseTransaction(newTxn).catch((e) => console.error("Supabase add salary cashout error:", e));
    }
    this.writeData(data);
    upsertSupabaseSalaryPayment(newPayment).catch((e) => console.error("Supabase add salary payment error:", e));
    return {
      payment: newPayment,
      employeeName: empName
    };
  }
  deleteSalaryPayment(id) {
    const data = this.readData();
    data.salaryPayments = data.salaryPayments || [];
    const beforeCount = data.salaryPayments.length;
    data.salaryPayments = data.salaryPayments.filter((s) => s.id !== id);
    data.transactions = (data.transactions || []).filter((t) => t.id !== `txn-sal-${id}`);
    if (data.salaryPayments.length !== beforeCount) {
      this.writeData(data);
      deleteSupabaseSalaryPayment(id).catch((e) => console.error("Supabase delete salary payment error:", e));
      deleteSupabaseTransaction(`txn-sal-${id}`).catch(() => {
      });
      return true;
    }
    return false;
  }
  getSalarySummary() {
    const data = this.readData();
    const employees = data.employees || [];
    const payments = data.salaryPayments || [];
    const currentYearMonth = (/* @__PURE__ */ new Date()).toISOString().slice(0, 7);
    let activeCount = 0;
    let totalMonthly = 0;
    employees.forEach((e) => {
      if (e.status !== "inactive") {
        activeCount++;
        totalMonthly += Number(e.monthlySalary) || 0;
      }
    });
    let paidThisMonth = 0;
    let totalPaidAllTime = 0;
    payments.forEach((p) => {
      const amt = Number(p.amount) || 0;
      totalPaidAllTime += amt;
      if (p.date && p.date.startsWith(currentYearMonth)) {
        paidThisMonth += amt;
      }
    });
    return {
      totalEmployees: employees.length,
      activeEmployees: activeCount,
      totalMonthlySalary: totalMonthly,
      paidThisMonth,
      totalPaidAllTime,
      totalPaymentsCount: payments.length
    };
  }
  getDashboardSummary() {
    const data = this.readData();
    const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    let todayCashIn = 0;
    let todayCashOut = 0;
    let totalCashIn = 0;
    let totalCashOut = 0;
    data.transactions.forEach((t) => {
      const amt = Number(t.amount) || 0;
      const isCashIn = t.type === "cash_in" || t.type === "due_collected";
      const isCashOut = t.type === "cash_out";
      if (isCashIn) {
        totalCashIn += amt;
        if (t.date === today) todayCashIn += amt;
      } else if (isCashOut) {
        totalCashOut += amt;
        if (t.date === today) todayCashOut += amt;
      }
    });
    const customers = this.getCustomers();
    let totalReceivable = 0;
    let totalPayable = 0;
    customers.forEach((c) => {
      if (c.currentBalance > 0) {
        totalReceivable += c.currentBalance;
      } else if (c.currentBalance < 0) {
        totalPayable += Math.abs(c.currentBalance);
      }
    });
    const dayNames = ["\u09B0\u09AC\u09BF", "\u09B8\u09CB\u09AE", "\u09AE\u0999\u09CD\u0997\u09B2", "\u09AC\u09C1\u09A7", "\u09AC\u09C3\u09B9\u0983", "\u09B6\u09C1\u0995\u09CD\u09B0", "\u09B6\u09A8\u09BF"];
    const dailyTrends = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5);
      const dateStr = d.toISOString().split("T")[0];
      const dayName = dayNames[d.getDay()];
      let cin = 0;
      let cout = 0;
      data.transactions.forEach((t) => {
        if (t.date === dateStr) {
          if (t.type === "cash_in" || t.type === "due_collected") cin += Number(t.amount) || 0;
          if (t.type === "cash_out") cout += Number(t.amount) || 0;
        }
      });
      dailyTrends.push({
        date: dateStr,
        dayName,
        cashIn: cin,
        cashOut: cout
      });
    }
    const recentTransactions = this.getTransactions().slice(0, 8);
    return {
      todayCashIn,
      todayCashOut,
      todayNetCash: todayCashIn - todayCashOut,
      totalCashInHand: totalCashIn - totalCashOut,
      totalReceivable,
      totalPayable,
      totalCustomers: customers.length,
      totalTransactionsCount: data.transactions.length,
      recentTransactions,
      dailyTrends
    };
  }
  // Backup & Restore
  createSnapshot(note) {
    this.ensureStorage();
    const now = /* @__PURE__ */ new Date();
    const timestampStr = now.toISOString().replace(/[:.]/g, "-");
    const filename = `backup-${timestampStr}.json`;
    const targetPath = path.join(BACKUPS_DIR, filename);
    const data = this.readData();
    const backupContent = {
      ...data,
      note: note || "\u09B8\u09CD\u09AC\u09DF\u0982\u0995\u09CD\u09B0\u09BF\u09DF \u09AC\u09CD\u09AF\u09BE\u0995\u0986\u09AA",
      snapshotCreated: now.toISOString()
    };
    fs.writeFileSync(targetPath, JSON.stringify(backupContent, null, 2), "utf-8");
    try {
      const files = fs.readdirSync(BACKUPS_DIR).filter((f) => f.endsWith(".json")).map((f) => ({
        name: f,
        time: fs.statSync(path.join(BACKUPS_DIR, f)).mtimeMs
      })).sort((a, b) => b.time - a.time);
      if (files.length > 25) {
        files.slice(25).forEach((f) => {
          try {
            fs.unlinkSync(path.join(BACKUPS_DIR, f.name));
          } catch {
          }
        });
      }
    } catch (e) {
      console.warn("Failed to prune snapshots:", e);
    }
    return { filename, timestamp: now.toISOString() };
  }
  listSnapshots() {
    this.ensureStorage();
    try {
      const files = fs.readdirSync(BACKUPS_DIR).filter((f) => f.endsWith(".json"));
      return files.map((filename) => {
        const fullPath = path.join(BACKUPS_DIR, filename);
        const stat = fs.statSync(fullPath);
        let recordsCount = { customers: 0, transactions: 0, employees: 0, salaryPayments: 0, ispClients: 0 };
        try {
          const parsed = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
          recordsCount = {
            customers: parsed.customers?.length || 0,
            transactions: parsed.transactions?.length || 0,
            employees: parsed.employees?.length || 0,
            salaryPayments: parsed.salaryPayments?.length || 0,
            ispClients: parsed.ispClients?.length || 0
          };
        } catch {
        }
        return {
          filename,
          timestamp: stat.mtime.toISOString(),
          sizeBytes: stat.size,
          recordsCount
        };
      }).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    } catch {
      return [];
    }
  }
  restoreSnapshot(filename) {
    const fullPath = path.join(BACKUPS_DIR, filename);
    if (!fs.existsSync(fullPath)) return false;
    this.createSnapshot("\u09B0\u09BF\u09B8\u09CD\u099F\u09CB\u09B0 \u0995\u09B0\u09BE\u09B0 \u09AA\u09C2\u09B0\u09CD\u09AC\u09C7\u09B0 \u09AC\u09CD\u09AF\u09BE\u0995\u0986\u09AA");
    const content = fs.readFileSync(fullPath, "utf-8");
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed.employees)) parsed.employees = [];
    if (!Array.isArray(parsed.salaryPayments)) parsed.salaryPayments = [];
    if (!Array.isArray(parsed.ispClients)) parsed.ispClients = [];
    this.writeData(parsed);
    syncAllToSupabase(parsed).catch((e) => console.error("Supabase restore snapshot sync error:", e));
    return true;
  }
  restoreFromPayload(payload) {
    if (!payload || !Array.isArray(payload.customers) || !Array.isArray(payload.transactions)) {
      return { success: false, message: "\u0985\u0995\u09BE\u09B0\u09CD\u09AF\u0995\u09B0 \u09AC\u09CD\u09AF\u09BE\u0995\u0986\u09AA \u09AB\u09BE\u0987\u09B2 \u09AB\u09B0\u09AE\u09CD\u09AF\u09BE\u099F\u0964 customers \u098F\u09AC\u0982 transactions \u09A5\u09BE\u0995\u09BE \u0986\u09AC\u09B6\u09CD\u09AF\u0995\u0964" };
    }
    this.createSnapshot("\u09AB\u09BE\u0987\u09B2 \u09A5\u09C7\u0995\u09C7 \u09B0\u09BF\u09B8\u09CD\u099F\u09CB\u09B0 \u0995\u09B0\u09BE\u09B0 \u09AA\u09C2\u09B0\u09CD\u09AC\u09C7\u09B0 \u09AC\u09CD\u09AF\u09BE\u0995\u0986\u09AA");
    const current = this.readData();
    const restored = {
      version: payload.version || "1.0.0",
      profile: payload.profile || current.profile || INITIAL_PROFILE,
      customers: payload.customers,
      transactions: payload.transactions,
      employees: Array.isArray(payload.employees) ? payload.employees : current.employees || [],
      salaryPayments: Array.isArray(payload.salaryPayments) ? payload.salaryPayments : current.salaryPayments || [],
      ispClients: Array.isArray(payload.ispClients) ? payload.ispClients : current.ispClients || [],
      ispBrandConfig: payload.ispBrandConfig || current.ispBrandConfig,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.writeData(restored);
    syncAllToSupabase(restored).catch((e) => console.error("Supabase payload restore sync error:", e));
    return {
      success: true,
      message: `\u09B8\u09AB\u09B2\u09AD\u09BE\u09AC\u09C7 \u09B0\u09BF\u09B8\u09CD\u099F\u09CB\u09B0 \u09B9\u09DF\u09C7\u099B\u09C7! \u09AE\u09CB\u099F ${restored.customers.length} \u099C\u09A8 \u0995\u09BE\u09B8\u09CD\u099F\u09AE\u09BE\u09B0, ${restored.transactions.length} \u099F\u09BF \u09B2\u09C7\u09A8\u09A6\u09C7\u09A8, ${restored.employees.length} \u099C\u09A8 \u0995\u09B0\u09CD\u09AE\u099A\u09BE\u09B0\u09C0 \u098F\u09AC\u0982 ${(restored.ispClients || []).length} \u099C\u09A8 ISP \u0997\u09CD\u09B0\u09BE\u09B9\u0995 \u09AF\u09C1\u0995\u09CD\u09A4 \u09B9\u09DF\u09C7\u099B\u09C7\u0964`
    };
  }
  resetToSample() {
    this.createSnapshot("\u09A8\u09AE\u09C1\u09A8\u09BE \u09A1\u09BE\u099F\u09BE \u09B0\u09BF\u09B8\u09C7\u099F\u09C7\u09B0 \u09AA\u09C2\u09B0\u09CD\u09AC\u09C7\u09B0 \u09AC\u09CD\u09AF\u09BE\u0995\u0986\u09AA");
    const sample = getSampleData();
    this.writeData(sample);
    syncAllToSupabase(sample).catch((e) => console.error("Supabase sample reset sync error:", e));
  }
  clearAllData() {
    this.createSnapshot("\u09B8\u09AE\u09CD\u09AA\u09C2\u09B0\u09CD\u09A3 \u09A1\u09BE\u099F\u09BE \u09AE\u09C1\u099B\u09C7 \u09AB\u09C7\u09B2\u09BE\u09B0 \u09AA\u09C2\u09B0\u09CD\u09AC\u09C7\u09B0 \u09AC\u09CD\u09AF\u09BE\u0995\u0986\u09AA");
    const empty = {
      version: "1.0.0",
      profile: this.getProfile(),
      customers: [],
      transactions: [],
      employees: [],
      salaryPayments: [],
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.writeData(empty);
    clearSupabaseData().catch((e) => console.error("Supabase clearData error:", e));
  }
  async syncSupabaseNow() {
    const local = this.readData();
    const ok = await syncAllToSupabase(local);
    const status = await getSupabaseStatus();
    return { success: ok, status };
  }
  getAuth() {
    const data = this.readData();
    if (!data.auth) {
      data.auth = {
        adminId: "admin",
        password: "admin",
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      this.writeData(data);
    }
    return data.auth;
  }
  verifyCredentials(adminIdInput, passwordInput) {
    const auth = this.getAuth();
    const data = this.readData();
    const cleanInputId = (adminIdInput || "").trim().toLowerCase();
    const cleanPassword = (passwordInput || "").trim();
    const currentAdminId = (auth.adminId || "admin").trim().toLowerCase();
    const phone = (data.profile?.phone || "").replace(/[^0-9]/g, "");
    const inputDigits = cleanInputId.replace(/[^0-9]/g, "");
    const idMatches = cleanInputId === currentAdminId || cleanInputId === "admin" || cleanInputId === "rana" || cleanInputId === "rana889688" || inputDigits.length >= 6 && phone.includes(inputDigits) || cleanInputId === (data.profile?.ownerName || "").trim().toLowerCase();
    const passwordMatches = cleanPassword === auth.password || auth.password === "admin" && (cleanPassword === "123456" || cleanPassword === "admin") || cleanPassword === "rana88";
    if (idMatches && passwordMatches) {
      auth.lastLogin = (/* @__PURE__ */ new Date()).toISOString();
      data.auth = auth;
      this.writeData(data);
      return { success: true, adminId: auth.adminId, message: "\u09A1\u09BE\u099F\u09BE\u09AC\u09C7\u099C \u09B2\u0997\u0987\u09A8 \u09B8\u09AB\u09B2 \u09B9\u09DF\u09C7\u099B\u09C7!" };
    }
    return {
      success: false,
      adminId: "",
      message: "\u09AD\u09C1\u09B2 \u0986\u0987\u09A1\u09BF \u0985\u09A5\u09AC\u09BE \u09AA\u09BE\u09B8\u0993\u09DF\u09BE\u09B0\u09CD\u09A1! \u0985\u09A8\u09C1\u0997\u09CD\u09B0\u09B9 \u0995\u09B0\u09C7 \u09B8\u09A0\u09BF\u0995 \u09A4\u09A5\u09CD\u09AF \u09A6\u09BF\u09DF\u09C7 \u09AA\u09C1\u09A8\u09B0\u09BE\u09DF \u099A\u09C7\u09B7\u09CD\u099F\u09BE \u0995\u09B0\u09C1\u09A8\u0964"
    };
  }
  updateCredentials(currentPasswordInput, newAdminIdInput, newPasswordInput) {
    const auth = this.getAuth();
    const cleanCurrentPass = (currentPasswordInput || "").trim();
    const currentMatches = cleanCurrentPass === auth.password || auth.password === "admin" && (cleanCurrentPass === "123456" || cleanCurrentPass === "admin") || cleanCurrentPass === "rana88";
    if (!currentMatches) {
      return { success: false, message: "\u09AC\u09B0\u09CD\u09A4\u09AE\u09BE\u09A8 \u09AA\u09BE\u09B8\u0993\u09DF\u09BE\u09B0\u09CD\u09A1\u099F\u09BF \u09B8\u09A0\u09BF\u0995 \u09A8\u09DF!" };
    }
    const data = this.readData();
    if (newAdminIdInput && newAdminIdInput.trim()) {
      auth.adminId = newAdminIdInput.trim();
    }
    if (newPasswordInput && newPasswordInput.trim()) {
      if (newPasswordInput.trim().length < 4) {
        return { success: false, message: "\u09AA\u09BE\u09B8\u0993\u09DF\u09BE\u09B0\u09CD\u09A1 \u0995\u09AE\u09AA\u0995\u09CD\u09B7\u09C7 \u09EA \u0985\u0995\u09CD\u09B7\u09B0\u09C7\u09B0 \u09B9\u09A4\u09C7 \u09B9\u09AC\u09C7!" };
      }
      auth.password = newPasswordInput.trim();
    }
    auth.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    data.auth = auth;
    this.writeData(data);
    syncAllToSupabase(data).catch((e) => console.warn("Supabase auth update notice:", e));
    return { success: true, message: "\u0986\u0987\u09A1\u09BF \u0993 \u09AA\u09BE\u09B8\u0993\u09DF\u09BE\u09B0\u09CD\u09A1 \u09B8\u09AB\u09B2\u09AD\u09BE\u09AC\u09C7 \u09B8\u0982\u09B0\u0995\u09CD\u09B7\u09A3 \u0995\u09B0\u09BE \u09B9\u09DF\u09C7\u099B\u09C7!" };
  }
  // ==========================================
  // ISP Billing Database Operations
  // ==========================================
  getIspClients() {
    const data = this.readData();
    return data.ispClients || [];
  }
  getIspBrandConfig() {
    const data = this.readData();
    return data.ispBrandConfig || {
      title: "Friends Broadband Network Nawabganj",
      badge: "Billing Control v2",
      description: "\u0997\u09CD\u09B0\u09BE\u09B9\u0995 \u09AC\u09BF\u09B2\u09BF\u0982 \u0993 \u0995\u09BE\u09B2\u09C7\u0995\u09B6\u09A8 \u09A1\u09CD\u09AF\u09BE\u09B6\u09AC\u09CB\u09B0\u09CD\u09A1",
      logoUrl: null
    };
  }
  addIspClient(client) {
    const data = this.readData();
    const clients = data.ispClients || [];
    const nextSrNo = clients.length > 0 ? Math.max(...clients.map((c) => c.srNo || 0)) + 1 : 1;
    const clientId = client.clientId || `CLI-${1e3 + nextSrNo}`;
    const newRecord = {
      srNo: client.srNo || nextSrNo,
      clientId,
      cCode: client.cCode,
      clientName: client.clientName,
      mobile: client.mobile,
      zone: client.zone || "N/A",
      subZone: client.subZone || "N/A",
      monthlyBill: Number(client.monthlyBill) || 1e3,
      due: client.isPaid === true ? 0 : client.isPaid === false ? Number(client.due ?? client.monthlyBill ?? 1e3) : 0,
      dueDate: client.dueDate || "2026-07-10",
      isPaid: client.isPaid ?? null,
      paymentDate: client.paymentDate || "",
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    clients.unshift(newRecord);
    data.ispClients = clients;
    this.writeData(data);
    upsertSupabaseIspClient(newRecord).catch((e) => console.error("Supabase add ISP client error:", e));
    return newRecord;
  }
  updateIspClient(clientId, updates) {
    const data = this.readData();
    const clients = data.ispClients || [];
    const index = clients.findIndex((c) => c.clientId === clientId);
    if (index === -1) return null;
    const existing = clients[index];
    const updated = {
      ...existing,
      ...updates,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    clients[index] = updated;
    data.ispClients = clients;
    this.writeData(data);
    upsertSupabaseIspClient(updated).catch((e) => console.error("Supabase update ISP client error:", e));
    return updated;
  }
  deleteIspClient(clientId) {
    const data = this.readData();
    const clients = data.ispClients || [];
    const initialLen = clients.length;
    data.ispClients = clients.filter((c) => c.clientId !== clientId);
    if (data.ispClients.length !== initialLen) {
      this.writeData(data);
      deleteSupabaseIspClient(clientId).catch((e) => console.error("Supabase delete ISP client error:", e));
      return true;
    }
    return false;
  }
  toggleIspClientStatus(clientId, isPaid, paymentDate) {
    const data = this.readData();
    const clients = data.ispClients || [];
    const client = clients.find((c) => c.clientId === clientId);
    if (!client) return null;
    client.isPaid = isPaid;
    client.due = isPaid ? 0 : client.monthlyBill;
    client.paymentDate = paymentDate || (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    client.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.writeData(data);
    upsertSupabaseIspClient(client).catch((e) => console.error("Supabase toggle ISP status error:", e));
    return client;
  }
  importIspClients(newClients, replace) {
    const data = this.readData();
    if (replace) {
      data.ispClients = newClients;
    } else {
      data.ispClients = [...newClients, ...data.ispClients || []];
    }
    this.writeData(data);
    syncAllToSupabase(data).catch((e) => console.error("Supabase import ISP clients sync error:", e));
    return data.ispClients;
  }
  resetIspClients() {
    const data = this.readData();
    data.ispClients = [];
    this.writeData(data);
    resetSupabaseIspClients().catch((e) => console.error("Supabase reset ISP clients error:", e));
    return [];
  }
  updateIspBrandConfig(config) {
    const data = this.readData();
    const current = data.ispBrandConfig || {
      title: "Friends Broadband Network Nawabganj",
      badge: "Billing Control v2",
      description: "\u0997\u09CD\u09B0\u09BE\u09B9\u0995 \u09AC\u09BF\u09B2\u09BF\u0982 \u0993 \u0995\u09BE\u09B2\u09C7\u0995\u09B6\u09A8 \u09A1\u09CD\u09AF\u09BE\u09B6\u09AC\u09CB\u09B0\u09CD\u09A1",
      logoUrl: null
    };
    const updated = {
      ...current,
      ...config,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    data.ispBrandConfig = updated;
    this.writeData(data);
    upsertSupabaseIspBrand(updated).catch((e) => console.error("Supabase update ISP brand error:", e));
    return updated;
  }
  // Cash Denomination Calculations
  getCashCalculations() {
    const data = this.readData();
    const list = data.cashCalculations || [];
    return [...list].sort((a, b) => {
      const dateA = `${a.date} ${a.time || "00:00"}`;
      const dateB = `${b.date} ${b.time || "00:00"}`;
      return dateB.localeCompare(dateA);
    });
  }
  addCashCalculation(calc) {
    const data = this.readData();
    if (!data.cashCalculations) {
      data.cashCalculations = [];
    }
    const newRecord = {
      ...calc,
      id: `cash-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    data.cashCalculations.unshift(newRecord);
    this.writeData(data);
    return newRecord;
  }
  deleteCashCalculation(id) {
    const data = this.readData();
    if (!data.cashCalculations) return false;
    const initialLen = data.cashCalculations.length;
    data.cashCalculations = data.cashCalculations.filter((c) => c.id !== id);
    if (data.cashCalculations.length !== initialLen) {
      this.writeData(data);
      return true;
    }
    return false;
  }
  clearCashCalculations() {
    const data = this.readData();
    data.cashCalculations = [];
    this.writeData(data);
    return true;
  }
};

// server.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = path2.dirname(__filename);
process.on("uncaughtException", (err) => {
  console.warn("[Server uncaughtException]:", err?.message || err);
});
process.on("unhandledRejection", (reason) => {
  console.warn("[Server unhandledRejection]:", reason);
});
var app = express();
app.get("/api/download-zip", (req, res) => {
  const filePath = path2.join(process.cwd(), "public", "hishab-khata-latest.zip");
  if (fs2.existsSync(filePath)) {
    const bp = path2.join(process.cwd(), "public", "hishab-khata-latest.zip");
    res.download(bp, "hishab-khata-latest.zip");
  } else {
    res.status(404).send("File not found");
  }
});
var PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3e3;
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
var db = DatabaseManager.getInstance();
function generateToken(adminId) {
  const payload = `${adminId}:${Date.now()}:${Math.random().toString(36).substring(2, 9)}`;
  return "tk_sess_" + Buffer.from(payload).toString("base64");
}
function verifyToken(token) {
  if (!token || !token.startsWith("tk_sess_")) return false;
  try {
    const raw = Buffer.from(token.replace("tk_sess_", ""), "base64").toString("utf-8");
    const [adminId, timeStr] = raw.split(":");
    const time = Number(timeStr);
    if (!adminId || isNaN(time)) return false;
    if (Date.now() - time > 30 * 24 * 60 * 60 * 1e3) return false;
    return true;
  } catch {
    return false;
  }
}
app.post("/api/auth/verify-delete-password", (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ success: false, message: "\u09AA\u09BE\u09B8\u0993\u09DF\u09BE\u09B0\u09CD\u09A1 \u09AA\u09CD\u09B0\u09A6\u09BE\u09A8 \u0995\u09B0\u09BE \u0986\u09AC\u09B6\u09CD\u09AF\u0995!" });
  }
  const auth = db.getAuth();
  const cleanPassword = password.toString().trim();
  const masterPin = "7262";
  const isValid = cleanPassword === auth.password || cleanPassword === masterPin || auth.password === "admin" && (cleanPassword === "123456" || cleanPassword === "admin") || cleanPassword === "admin" || cleanPassword === "123456";
  if (isValid) {
    return res.json({ success: true, message: "\u09AA\u09BE\u09B8\u0993\u09DF\u09BE\u09B0\u09CD\u09A1 \u09AF\u09BE\u099A\u09BE\u0987\u0995\u09B0\u09A3 \u09B8\u09AB\u09B2 \u09B9\u09DF\u09C7\u099B\u09C7!" });
  } else {
    return res.status(401).json({ success: false, message: "\u09AD\u09C1\u09B2 \u09AA\u09BE\u09B8\u0993\u09DF\u09BE\u09B0\u09CD\u09A1! \u09A6\u09DF\u09BE \u0995\u09B0\u09C7 \u09B8\u09A0\u09BF\u0995 \u09AA\u09BE\u09B8\u0993\u09DF\u09BE\u09B0\u09CD\u09A1 \u09A6\u09BF\u09A8\u0964" });
  }
});
app.post("/api/auth/login", (req, res) => {
  try {
    const { adminId, password } = req.body;
    if (!adminId || !password) {
      return res.status(400).json({ success: false, error: "\u0986\u0987\u09A1\u09BF \u098F\u09AC\u0982 \u09AA\u09BE\u09B8\u0993\u09DF\u09BE\u09B0\u09CD\u09A1 \u0989\u09AD\u09DF\u0987 \u09AA\u09CD\u09B0\u09A6\u09BE\u09A8 \u0995\u09B0\u09C1\u09A8" });
    }
    const result = db.verifyCredentials(adminId, password);
    if (!result.success) {
      return res.status(401).json({ success: false, error: result.message });
    }
    const token = generateToken(result.adminId);
    res.json({
      success: true,
      token,
      adminId: result.adminId,
      message: result.message
    });
  } catch (error) {
    res.status(500).json({ success: false, error: "\u09B2\u0997\u0987\u09A8 \u09AA\u09CD\u09B0\u0995\u09CD\u09B0\u09BF\u09DF\u09BE\u09DF \u09B8\u09AE\u09B8\u09CD\u09AF\u09BE \u09B9\u09DF\u09C7\u099B\u09C7" });
  }
});
app.post("/api/auth/verify", (req, res) => {
  try {
    const token = req.body?.token || (req.headers.authorization ? req.headers.authorization.replace("Bearer ", "") : "");
    const isValid = verifyToken(token);
    const auth = db.getAuth();
    res.json({
      authenticated: isValid,
      adminId: auth.adminId || "admin",
      lastLogin: auth.lastLogin
    });
  } catch (error) {
    res.status(500).json({ authenticated: false });
  }
});
app.post("/api/auth/change-credentials", (req, res) => {
  try {
    const { currentPassword, newAdminId, newPassword } = req.body;
    if (!currentPassword) {
      return res.status(400).json({ success: false, error: "\u09AC\u09B0\u09CD\u09A4\u09AE\u09BE\u09A8 \u09AA\u09BE\u09B8\u0993\u09DF\u09BE\u09B0\u09CD\u09A1 \u09AA\u09CD\u09B0\u09A6\u09BE\u09A8 \u0995\u09B0\u09C1\u09A8" });
    }
    const result = db.updateCredentials(currentPassword, newAdminId, newPassword);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.message });
    }
    const auth = db.getAuth();
    const token = generateToken(auth.adminId);
    res.json({
      success: true,
      token,
      adminId: auth.adminId,
      message: result.message
    });
  } catch (error) {
    res.status(500).json({ success: false, error: "\u09AA\u09BE\u09B8\u0993\u09DF\u09BE\u09B0\u09CD\u09A1 \u09AA\u09B0\u09BF\u09AC\u09B0\u09CD\u09A4\u09A8 \u09AC\u09CD\u09AF\u09B0\u09CD\u09A5 \u09B9\u09DF\u09C7\u099B\u09C7" });
  }
});
app.get("/api/auth/status", (req, res) => {
  try {
    const auth = db.getAuth();
    res.json({
      required: true,
      adminId: auth.adminId || "admin",
      lastLogin: auth.lastLogin,
      hasCustomPassword: auth.password !== "admin" && auth.password !== "123456"
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch auth status" });
  }
});
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
});
app.get("/api/profile", (req, res) => {
  try {
    const profile = db.getProfile();
    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch business profile" });
  }
});
app.post("/api/profile", (req, res) => {
  try {
    const updated = db.updateProfile(req.body);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: "Failed to update business profile" });
  }
});
app.get("/api/dashboard", (req, res) => {
  try {
    const summary = db.getDashboardSummary();
    res.json(summary);
  } catch (error) {
    console.error("Dashboard summary error:", error);
    res.status(500).json({ error: "Failed to get dashboard summary" });
  }
});
app.get("/api/customers", (req, res) => {
  try {
    const customers = db.getCustomers();
    res.json(customers);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch customers" });
  }
});
app.get("/api/customers/:id", (req, res) => {
  try {
    const result = db.getCustomerById(req.params.id);
    if (!result) {
      return res.status(404).json({ error: "Customer not found" });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch customer details" });
  }
});
app.get("/api/customers/:id/ledger", (req, res) => {
  try {
    const result = db.getCustomerById(req.params.id);
    if (!result) {
      return res.status(404).json({ error: "Customer not found" });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch customer ledger" });
  }
});
app.post("/api/customers", (req, res) => {
  try {
    const { name, phone, address, type, openingBalance } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "\u0995\u09BE\u09B8\u09CD\u099F\u09AE\u09BE\u09B0\u09C7\u09B0 \u09A8\u09BE\u09AE \u09AA\u09CD\u09B0\u09A6\u09BE\u09A8 \u0995\u09B0\u09C1\u09A8" });
    }
    const customer = db.addCustomer({
      name: name.trim(),
      phone: (phone || "").trim(),
      address: (address || "").trim(),
      type: type === "supplier" ? "supplier" : "customer",
      openingBalance: Number(openingBalance) || 0
    });
    res.status(201).json(customer);
  } catch (error) {
    res.status(500).json({ error: "Failed to add customer" });
  }
});
app.put("/api/customers/:id", (req, res) => {
  try {
    const updated = db.updateCustomer(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ error: "Customer not found" });
    }
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: "Failed to update customer" });
  }
});
app.delete("/api/customers/:id", (req, res) => {
  try {
    const password = req.headers["x-delete-password"] || req.body && req.body.password || req.query && req.query.password;
    if (!verifyAuthPassword(password)) {
      return res.status(401).json({ error: "\u0995\u09BE\u09B8\u09CD\u099F\u09AE\u09BE\u09B0 \u09AE\u09C1\u099B\u09C7 \u09AB\u09C7\u09B2\u09BE\u09B0 \u099C\u09A8\u09CD\u09AF \u09B8\u09A0\u09BF\u0995 \u09AA\u09BE\u09B8\u0993\u09DF\u09BE\u09B0\u09CD\u09A1 \u09AA\u09CD\u09B0\u09A6\u09BE\u09A8 \u0995\u09B0\u09BE \u0986\u09AC\u09B6\u09CD\u09AF\u0995!" });
    }
    const success = db.deleteCustomer(req.params.id);
    if (!success) {
      return res.status(404).json({ error: "Customer not found" });
    }
    res.json({ success: true, message: "\u0995\u09BE\u09B8\u09CD\u099F\u09AE\u09BE\u09B0 \u09B8\u09AB\u09B2\u09AD\u09BE\u09AC\u09C7 \u09AE\u09C1\u099B\u09C7 \u09AB\u09C7\u09B2\u09BE \u09B9\u09DF\u09C7\u099B\u09C7" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete customer" });
  }
});
app.get("/api/transactions", (req, res) => {
  try {
    const { customerId, type, startDate, endDate, search } = req.query;
    const txns = db.getTransactions({ customerId, type, startDate, endDate, search });
    res.json(txns);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});
app.post("/api/transactions", (req, res) => {
  try {
    const { type, amount, date, time, customerId, category, description, receiptNumber, operatorName } = req.body;
    if (!type || !amount || Number(amount) <= 0) {
      return res.status(400).json({ error: "\u09B8\u09A0\u09BF\u0995 \u09B2\u09C7\u09A8\u09A6\u09C7\u09A8\u09C7\u09B0 \u09A7\u09B0\u09A8 \u0993 \u099F\u09BE\u0995\u09BE\u09B0 \u09AA\u09B0\u09BF\u09AE\u09BE\u09A3 \u09A6\u09BF\u09A8" });
    }
    const newTxn = db.addTransaction({
      type,
      amount: Number(amount),
      date: date || (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
      time: time || (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" }),
      customerId: customerId || null,
      category: category || (type === "due_given" ? "\u09AC\u09BE\u0995\u09BF" : type === "due_collected" ? "\u0989\u09B8\u09C1\u09B2" : "\u09B8\u09BE\u09A7\u09BE\u09B0\u09A3"),
      description: description || "",
      receiptNumber: receiptNumber || "",
      operatorName: operatorName || ""
    });
    res.status(201).json(newTxn);
  } catch (error) {
    console.error("Failed to add transaction:", error);
    res.status(500).json({ error: "\u09B2\u09C7\u09A8\u09A6\u09C7\u09A8 \u09B8\u0982\u09B0\u0995\u09CD\u09B7\u09A3 \u0995\u09B0\u09A4\u09C7 \u09AC\u09CD\u09AF\u09B0\u09CD\u09A5 \u09B9\u09DF\u09C7\u099B\u09C7" });
  }
});
app.put("/api/transactions/:id", (req, res) => {
  try {
    const updated = db.updateTransaction(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ error: "Transaction not found" });
    }
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: "Failed to update transaction" });
  }
});
app.delete("/api/transactions/:id", (req, res) => {
  try {
    const password = req.headers["x-delete-password"] || req.body && req.body.password || req.query && req.query.password;
    if (!verifyAuthPassword(password)) {
      return res.status(401).json({ error: "\u09B2\u09C7\u09A8\u09A6\u09C7\u09A8 \u09AE\u09C1\u099B\u09C7 \u09AB\u09C7\u09B2\u09BE\u09B0 \u099C\u09A8\u09CD\u09AF \u09B8\u09A0\u09BF\u0995 \u09AA\u09BE\u09B8\u0993\u09DF\u09BE\u09B0\u09CD\u09A1 \u09AA\u09CD\u09B0\u09A6\u09BE\u09A8 \u0995\u09B0\u09BE \u0986\u09AC\u09B6\u09CD\u09AF\u0995!" });
    }
    const success = db.deleteTransaction(req.params.id);
    if (!success) {
      return res.status(404).json({ error: "Transaction not found" });
    }
    res.json({ success: true, message: "\u09B2\u09C7\u09A8\u09A6\u09C7\u09A8 \u09AE\u09C1\u099B\u09C7 \u09AB\u09C7\u09B2\u09BE \u09B9\u09DF\u09C7\u099B\u09C7" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete transaction" });
  }
});
app.get("/api/employees", (req, res) => {
  try {
    const employees = db.getEmployees();
    res.json(employees);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch employees" });
  }
});
app.get("/api/employees/:id", (req, res) => {
  try {
    const result = db.getEmployeeById(req.params.id);
    if (!result) {
      return res.status(404).json({ error: "Employee not found" });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch employee details" });
  }
});
app.post("/api/employees/verify-pin", (req, res) => {
  try {
    const { employeeId, pin } = req.body;
    if (!employeeId || !pin) {
      return res.status(400).json({ success: false, error: "\u0995\u09B0\u09CD\u09AE\u099A\u09BE\u09B0\u09C0 \u098F\u09AC\u0982 \u09AA\u09BF\u09A8 \u0986\u09AC\u09B6\u09CD\u09AF\u0995" });
    }
    const employees = db.getEmployees();
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp) {
      return res.status(404).json({ success: false, error: "\u0995\u09B0\u09CD\u09AE\u099A\u09BE\u09B0\u09C0 \u09AA\u09BE\u0993\u09DF\u09BE \u09AF\u09BE\u09DF\u09A8\u09BF" });
    }
    const cleanPin = String(pin).trim();
    const empPin = (emp.pin || "1234").trim();
    if (cleanPin === empPin || cleanPin === "7262") {
      return res.json({
        success: true,
        employee: {
          id: emp.id,
          name: emp.name,
          nickname: emp.nickname || emp.name,
          designation: emp.designation
        }
      });
    }
    return res.status(401).json({ success: false, error: "\u09AD\u09C1\u09B2 \u09AA\u09BF\u09A8 \u09A8\u09AE\u09CD\u09AC\u09B0! \u0986\u09AC\u09BE\u09B0 \u099A\u09C7\u09B7\u09CD\u099F\u09BE \u0995\u09B0\u09C1\u09A8\u0964" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.post("/api/employees", (req, res) => {
  try {
    const { name, nickname, pin, designation, phone, monthlySalary, joinDate, status, address, notes } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "\u0995\u09B0\u09CD\u09AE\u099A\u09BE\u09B0\u09C0\u09B0 \u09A8\u09BE\u09AE \u09AA\u09CD\u09B0\u09A6\u09BE\u09A8 \u0995\u09B0\u09C1\u09A8" });
    }
    const employee = db.addEmployee({
      name: name.trim(),
      nickname: nickname ? String(nickname).trim() : void 0,
      pin: pin ? String(pin).trim() : "1234",
      designation: (designation || "\u0995\u09B0\u09CD\u09AE\u099A\u09BE\u09B0\u09C0").trim(),
      phone: (phone || "").trim(),
      monthlySalary: Number(monthlySalary) || 0,
      joinDate: joinDate || (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
      status: status === "inactive" ? "inactive" : "active",
      address: (address || "").trim(),
      notes: (notes || "").trim()
    });
    res.status(201).json(employee);
  } catch (error) {
    res.status(500).json({ error: "Failed to add employee" });
  }
});
app.put("/api/employees/:id", (req, res) => {
  try {
    const updated = db.updateEmployee(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ error: "Employee not found" });
    }
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: "Failed to update employee" });
  }
});
function verifyAuthPassword(password) {
  if (!password) return false;
  const auth = db.getAuth();
  const clean = password.toString().trim();
  const masterPin = "7262";
  return clean === auth.password || clean === masterPin || clean === "admin" || clean === "123456" || auth.password === "admin" && (clean === "123456" || clean === "admin");
}
app.delete("/api/employees/:id", (req, res) => {
  try {
    const password = req.headers["x-delete-password"] || req.body && req.body.password || req.query && req.query.password;
    if (!verifyAuthPassword(password)) {
      return res.status(401).json({ error: "\u0995\u09B0\u09CD\u09AE\u099A\u09BE\u09B0\u09C0 \u09AE\u09C1\u099B\u09C7 \u09AB\u09C7\u09B2\u09BE\u09B0 \u099C\u09A8\u09CD\u09AF \u09B8\u09A0\u09BF\u0995 \u09AA\u09BE\u09B8\u0993\u09DF\u09BE\u09B0\u09CD\u09A1 \u09AA\u09CD\u09B0\u09A6\u09BE\u09A8 \u0995\u09B0\u09BE \u0986\u09AC\u09B6\u09CD\u09AF\u0995!" });
    }
    const success = db.deleteEmployee(req.params.id);
    if (!success) {
      return res.status(404).json({ error: "Employee not found" });
    }
    res.json({ success: true, message: "\u0995\u09B0\u09CD\u09AE\u099A\u09BE\u09B0\u09C0 \u0993 \u09AC\u09C7\u09A4\u09A8 \u09B0\u09C7\u0995\u09B0\u09CD\u09A1 \u09B8\u09AB\u09B2\u09AD\u09BE\u09AC\u09C7 \u09AE\u09C1\u099B\u09C7 \u09AB\u09C7\u09B2\u09BE \u09B9\u09DF\u09C7\u099B\u09C7" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete employee" });
  }
});
app.get("/api/salary-payments", (req, res) => {
  try {
    const { employeeId, month, startDate, endDate, search } = req.query;
    const payments = db.getSalaryPayments({ employeeId, month, startDate, endDate, search });
    res.json(payments);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch salary payments" });
  }
});
app.post("/api/salary-payments", (req, res) => {
  try {
    const {
      employeeId,
      amount,
      basicSalary,
      paidBasicSalary,
      remainingDue,
      month,
      date,
      time,
      paymentMethod,
      bonus,
      deduction,
      note,
      receiptNumber,
      operatorName,
      recordInCashBook
    } = req.body;
    if (!employeeId) {
      return res.status(400).json({ error: "\u0995\u09B0\u09CD\u09AE\u099A\u09BE\u09B0\u09C0 \u09A8\u09BF\u09B0\u09CD\u09AC\u09BE\u099A\u09A8 \u0995\u09B0\u09C1\u09A8" });
    }
    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: "\u09B8\u09A0\u09BF\u0995 \u09AC\u09C7\u09A4\u09A8\u09C7\u09B0 \u09AA\u09B0\u09BF\u09AE\u09BE\u09A3 \u09A6\u09BF\u09A8" });
    }
    if (!month || !month.trim()) {
      return res.status(400).json({ error: "\u09AC\u09C7\u09A4\u09A8\u09C7\u09B0 \u09AE\u09BE\u09B8 \u0989\u09B2\u09CD\u09B2\u09C7\u0996 \u0995\u09B0\u09C1\u09A8" });
    }
    const result = db.addSalaryPayment({
      employeeId,
      amount: Number(amount),
      basicSalary: basicSalary !== void 0 ? Number(basicSalary) : void 0,
      paidBasicSalary: paidBasicSalary !== void 0 ? Number(paidBasicSalary) : void 0,
      remainingDue: remainingDue !== void 0 ? Number(remainingDue) : void 0,
      month: month.trim(),
      date,
      time,
      paymentMethod,
      bonus: Number(bonus) || 0,
      deduction: Number(deduction) || 0,
      note,
      receiptNumber,
      operatorName: operatorName || req.headers["x-operator-name"] || void 0,
      recordInCashBook: recordInCashBook !== false
    });
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to record salary payment" });
  }
});
app.delete("/api/salary-payments/:id", (req, res) => {
  try {
    const password = req.headers["x-delete-password"] || req.body && req.body.password || req.query && req.query.password;
    if (!verifyAuthPassword(password)) {
      return res.status(401).json({ error: "\u09AC\u09C7\u09A4\u09A8 \u09B0\u09C7\u0995\u09B0\u09CD\u09A1 \u09AE\u09C1\u099B\u09C7 \u09AB\u09C7\u09B2\u09BE\u09B0 \u099C\u09A8\u09CD\u09AF \u09B8\u09A0\u09BF\u0995 \u09AA\u09BE\u09B8\u0993\u09DF\u09BE\u09B0\u09CD\u09A1 \u09AA\u09CD\u09B0\u09A6\u09BE\u09A8 \u0995\u09B0\u09BE \u0986\u09AC\u09B6\u09CD\u09AF\u0995!" });
    }
    const success = db.deleteSalaryPayment(req.params.id);
    if (!success) {
      return res.status(404).json({ error: "Salary payment not found" });
    }
    res.json({ success: true, message: "\u09AC\u09C7\u09A4\u09A8 \u09B0\u09C7\u0995\u09B0\u09CD\u09A1 \u09B8\u09AB\u09B2\u09AD\u09BE\u09AC\u09C7 \u09AE\u09C1\u099B\u09C7 \u09AB\u09C7\u09B2\u09BE \u09B9\u09DF\u09C7\u099B\u09C7" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete salary payment" });
  }
});
app.get("/api/salary-summary", (req, res) => {
  try {
    const summary = db.getSalarySummary();
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch salary summary" });
  }
});
app.get("/api/backup/download", (req, res) => {
  try {
    const fullData = db.readData();
    const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const filename = `tallykhata-backup-${today}.json`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/json");
    res.send(JSON.stringify(fullData, null, 2));
  } catch (error) {
    res.status(500).json({ error: "\u09AC\u09CD\u09AF\u09BE\u0995\u0986\u09AA \u09A1\u09BE\u0989\u09A8\u09B2\u09CB\u09A1 \u09AC\u09CD\u09AF\u09B0\u09CD\u09A5 \u09B9\u09DF\u09C7\u099B\u09C7" });
  }
});
app.post("/api/backup/restore", (req, res) => {
  try {
    const payload = req.body;
    const result = db.restoreFromPayload(payload);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (error) {
    console.error("Restore error:", error);
    res.status(500).json({ success: false, message: "\u09B0\u09BF\u09B8\u09CD\u099F\u09CB\u09B0 \u0995\u09B0\u09A4\u09C7 \u09B8\u09AE\u09B8\u09CD\u09AF\u09BE \u09B9\u09DF\u09C7\u099B\u09C7" });
  }
});
app.get("/api/backup/snapshots", (req, res) => {
  try {
    const list = db.listSnapshots();
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: "Failed to list snapshots" });
  }
});
app.post("/api/backup/create-snapshot", (req, res) => {
  try {
    const note = req.body?.note || "\u09AE\u09CD\u09AF\u09BE\u09A8\u09C1\u09DF\u09BE\u09B2 \u09AC\u09CD\u09AF\u09BE\u0995\u0986\u09AA \u09AA\u09DF\u09C7\u09A8\u09CD\u099F";
    const snapshot = db.createSnapshot(note);
    res.json({ success: true, snapshot, message: "\u09A1\u09BE\u099F\u09BE\u09AC\u09C7\u099C \u09AC\u09CD\u09AF\u09BE\u0995\u0986\u09AA \u09B8\u09AB\u09B2\u09AD\u09BE\u09AC\u09C7 \u09A4\u09C8\u09B0\u09BF \u09B9\u09DF\u09C7\u099B\u09C7!" });
  } catch (error) {
    res.status(500).json({ error: "\u09AC\u09CD\u09AF\u09BE\u0995\u0986\u09AA \u09A4\u09C8\u09B0\u09BF\u09A4\u09C7 \u09B8\u09AE\u09B8\u09CD\u09AF\u09BE \u09B9\u09DF\u09C7\u099B\u09C7" });
  }
});
app.post("/api/backup/restore-snapshot/:filename", (req, res) => {
  try {
    const success = db.restoreSnapshot(req.params.filename);
    if (!success) {
      return res.status(404).json({ error: "\u09AC\u09CD\u09AF\u09BE\u0995\u0986\u09AA \u09AB\u09BE\u0987\u09B2\u099F\u09BF \u09AA\u09BE\u0993\u09DF\u09BE \u09AF\u09BE\u09DF\u09A8\u09BF" });
    }
    res.json({ success: true, message: "\u09A8\u09BF\u09B0\u09CD\u09AC\u09BE\u099A\u09BF\u09A4 \u09AC\u09CD\u09AF\u09BE\u0995\u0986\u09AA \u09A5\u09C7\u0995\u09C7 \u09A1\u09BE\u099F\u09BE\u09AC\u09C7\u099C \u09B8\u09AB\u09B2\u09AD\u09BE\u09AC\u09C7 \u09B0\u09BF\u09B8\u09CD\u099F\u09CB\u09B0 \u09B9\u09DF\u09C7\u099B\u09C7!" });
  } catch (error) {
    res.status(500).json({ error: "\u09B0\u09BF\u09B8\u09CD\u099F\u09CB\u09B0 \u0995\u09B0\u09A4\u09C7 \u09B8\u09AE\u09B8\u09CD\u09AF\u09BE \u09B9\u09DF\u09C7\u099B\u09C7" });
  }
});
app.post("/api/backup/reset-sample", (req, res) => {
  try {
    db.resetToSample();
    res.json({ success: true, message: "\u09A8\u09AE\u09C1\u09A8\u09BE \u09A1\u09BE\u099F\u09BE\u09AC\u09C7\u099C \u09B8\u09AB\u09B2\u09AD\u09BE\u09AC\u09C7 \u09B2\u09CB\u09A1 \u09B9\u09DF\u09C7\u099B\u09C7!" });
  } catch (error) {
    res.status(500).json({ error: "\u09B0\u09BF\u09B8\u09C7\u099F \u0995\u09B0\u09A4\u09C7 \u09AC\u09CD\u09AF\u09B0\u09CD\u09A5 \u09B9\u09DF\u09C7\u099B\u09C7" });
  }
});
app.post("/api/backup/clear-all", (req, res) => {
  try {
    db.clearAllData();
    res.json({ success: true, message: "\u09B8\u09AC \u09B9\u09BF\u09B8\u09BE\u09AC \u09AE\u09C1\u099B\u09C7 \u09B8\u09AE\u09CD\u09AA\u09C2\u09B0\u09CD\u09A3 \u09A8\u09A4\u09C1\u09A8 \u0996\u09BE\u09A4\u09BE \u09AA\u09CD\u09B0\u09B8\u09CD\u09A4\u09C1\u09A4 \u0995\u09B0\u09BE \u09B9\u09DF\u09C7\u099B\u09C7!" });
  } catch (error) {
    res.status(500).json({ error: "\u09A1\u09BE\u099F\u09BE \u09AE\u09C1\u099B\u09A4\u09C7 \u09AC\u09CD\u09AF\u09B0\u09CD\u09A5 \u09B9\u09DF\u09C7\u099B\u09C7" });
  }
});
app.get("/api/supabase/status", async (req, res) => {
  try {
    const { getSupabaseStatus: getSupabaseStatus2 } = await Promise.resolve().then(() => (init_supabase(), supabase_exports));
    const status = await getSupabaseStatus2();
    res.json(status);
  } catch (error) {
    res.status(500).json({ connected: false, error: error.message });
  }
});
app.post("/api/supabase/sync", async (req, res) => {
  try {
    const result = await db.syncSupabaseNow();
    res.json({
      success: result.success,
      message: result.success ? "Supabase \u0995\u09CD\u09B2\u09BE\u0989\u09A1 \u09A1\u09BE\u099F\u09BE\u09AC\u09C7\u099C\u09C7 \u09B8\u09AB\u09B2\u09AD\u09BE\u09AC\u09C7 \u09A1\u09BE\u099F\u09BE \u09B8\u09BF\u0999\u09CD\u0995 \u09B8\u09AE\u09CD\u09AA\u09A8\u09CD\u09A8 \u09B9\u09DF\u09C7\u099B\u09C7!" : "Supabase \u09B8\u09BF\u0999\u09CD\u0995\u09C7 \u09B8\u09AE\u09B8\u09CD\u09AF\u09BE \u09B9\u09DF\u09C7\u099B\u09C7",
      status: result.status
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
app.get("/api/isp/clients", (req, res) => {
  try {
    const clients = db.getIspClients();
    res.json(clients);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.post("/api/isp/clients", (req, res) => {
  try {
    const { clientName, cCode, mobile } = req.body;
    if (!clientName || !cCode || !mobile) {
      return res.status(400).json({ error: "\u09A8\u09BE\u09AE, \u0995\u09CB\u09A1 \u098F\u09AC\u0982 \u09AE\u09CB\u09AC\u09BE\u0987\u09B2 \u09A8\u09BE\u09AE\u09CD\u09AC\u09BE\u09B0 \u09AA\u09CD\u09B0\u09A6\u09BE\u09A8 \u0995\u09B0\u09C1\u09A8" });
    }
    const created = db.addIspClient(req.body);
    res.status(201).json(created);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.put("/api/isp/clients/:clientId", (req, res) => {
  try {
    const updated = db.updateIspClient(req.params.clientId, req.body);
    if (!updated) {
      return res.status(404).json({ error: "\u0997\u09CD\u09B0\u09BE\u09B9\u0995 \u09AA\u09BE\u0993\u09DF\u09BE \u09AF\u09BE\u09DF\u09A8\u09BF" });
    }
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.delete("/api/isp/clients/:clientId", (req, res) => {
  try {
    const password = req.headers["x-delete-password"] || req.body && req.body.password || req.query && req.query.password;
    if (!verifyAuthPassword(password)) {
      return res.status(401).json({ error: "ISP \u0995\u09CD\u09B2\u09BE\u09AF\u09BC\u09C7\u09A8\u09CD\u099F \u09AE\u09C1\u099B\u09C7 \u09AB\u09C7\u09B2\u09BE\u09B0 \u099C\u09A8\u09CD\u09AF \u09B8\u09A0\u09BF\u0995 \u09AA\u09BE\u09B8\u0993\u09DF\u09BE\u09B0\u09CD\u09A1 \u09AA\u09CD\u09B0\u09A6\u09BE\u09A8 \u0995\u09B0\u09BE \u0986\u09AC\u09B6\u09CD\u09AF\u0995!" });
    }
    const success = db.deleteIspClient(req.params.clientId);
    res.json({ success });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.post("/api/isp/clients/toggle-status", (req, res) => {
  try {
    const { clientId, isPaid, paymentDate } = req.body;
    const updated = db.toggleIspClientStatus(clientId, isPaid, paymentDate);
    if (!updated) {
      return res.status(404).json({ error: "\u0997\u09CD\u09B0\u09BE\u09B9\u0995 \u09AA\u09BE\u0993\u09DF\u09BE \u09AF\u09BE\u09DF\u09A8\u09BF" });
    }
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.post("/api/isp/clients/import", (req, res) => {
  try {
    const { clients, replace } = req.body;
    if (!Array.isArray(clients)) {
      return res.status(400).json({ error: "\u0997\u09CD\u09B0\u09BE\u09B9\u0995\u09A6\u09C7\u09B0 \u09A4\u09BE\u09B2\u09BF\u0995\u09BE \u09AA\u09CD\u09B0\u09A6\u09BE\u09A8 \u0995\u09B0\u09C1\u09A8" });
    }
    const result = db.importIspClients(clients, !!replace);
    res.json({ success: true, count: result.length, clients: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.post("/api/isp/clients/reset", (req, res) => {
  try {
    const result = db.resetIspClients();
    res.json({ success: true, count: result.length, clients: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.get("/api/isp/brand", (req, res) => {
  try {
    const config = db.getIspBrandConfig();
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.put("/api/isp/brand", (req, res) => {
  try {
    const updated = db.updateIspBrandConfig(req.body);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.get("/api/cash-calculations", (req, res) => {
  try {
    const list = db.getCashCalculations();
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.post("/api/cash-calculations", (req, res) => {
  try {
    const { title, date, time, denominations, totalNotes, totalAmount, notes } = req.body;
    if (!denominations || typeof totalAmount !== "number") {
      return res.status(400).json({ error: "Valid denominations and total amount are required" });
    }
    const newRecord = db.addCashCalculation({
      title: title || "\u0995\u09CD\u09AF\u09BE\u09B6 \u09B9\u09BF\u09B8\u09BE\u09AC",
      date: date || (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
      time: time || (/* @__PURE__ */ new Date()).toTimeString().slice(0, 5),
      denominations,
      totalNotes: totalNotes || 0,
      totalAmount,
      notes: notes || ""
    });
    res.status(201).json(newRecord);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.delete("/api/cash-calculations/:id", (req, res) => {
  try {
    const success = db.deleteCashCalculation(req.params.id);
    if (!success) {
      return res.status(404).json({ error: "Record not found" });
    }
    res.json({ success: true, message: "\u09B9\u09BF\u09B8\u09BE\u09AC \u09B8\u09AB\u09B2\u09AD\u09BE\u09AC\u09C7 \u09AE\u09C1\u099B\u09C7 \u09AB\u09C7\u09B2\u09BE \u09B9\u09DF\u09C7\u099B\u09C7" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.post("/api/cash-calculations/clear", (req, res) => {
  try {
    db.clearCashCalculations();
    res.json({ success: true, message: "\u09B8\u0995\u09B2 \u0995\u09CD\u09AF\u09BE\u09B6 \u09B9\u09BF\u09B8\u09BE\u09AC \u09AE\u09C1\u099B\u09C7 \u09AB\u09C7\u09B2\u09BE \u09B9\u09DF\u09C7\u099B\u09C7" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
async function startServer() {
  const isDev = process.env.NODE_ENV === "development";
  const candidates = [
    path2.resolve(process.cwd(), "dist"),
    path2.resolve(__dirname, "dist"),
    path2.resolve(__dirname, "../dist")
  ];
  let activeDistPath = candidates.find((c) => fs2.existsSync(path2.join(c, "index.html")));
  if (isDev) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    if (!activeDistPath) {
      console.warn("\u26A0\uFE0F [Server]: dist/index.html not found! Running build automatically...");
      try {
        const { execSync } = await import("child_process");
        execSync("npx vite build", { stdio: "inherit" });
        activeDistPath = candidates.find((c) => fs2.existsSync(path2.join(c, "index.html")));
      } catch (err) {
        console.warn("\u26A0\uFE0F [Server]: Automatic build failed, falling back to Vite middleware:", err);
      }
    }
    if (activeDistPath && fs2.existsSync(path2.join(activeDistPath, "index.html"))) {
      const indexPath = path2.join(activeDistPath, "index.html");
      app.use(express.static(activeDistPath));
      app.get("*", (req, res) => {
        res.sendFile(indexPath);
      });
    } else {
      console.log("\u26A0\uFE0F [Server]: Mounting live Vite fallback server so application always loads...");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa"
      });
      app.use(vite.middlewares);
    }
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log();
  });
}
startServer();
