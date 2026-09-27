import { CRM } from "@/components/atomic-crm/root/CRM";
import {
  authProvider,
  dataProvider,
} from "@/components/atomic-crm/providers/fakerest";
import { memoryStore } from "ra-core";
import { HashRouter } from "react-router";

// Hash routing lets the static demo be served from any path
const App = () => (
  <HashRouter>
    <CRM
      dataProvider={dataProvider}
      authProvider={authProvider}
      store={memoryStore()}
    />
  </HashRouter>
);

export default App;
