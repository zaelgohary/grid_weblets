import type { default as VM } from "../types/vm";
import type { IProfile } from "../types/Profile";
import deploy from "./deploy";

import { selectGatewayNode, getUniqueDomainName } from "./gatewayHelpers";

const { HTTPMessageBusClient } = window.configs?.client ?? {};
const {
  DiskModel,
  MachineModel,
  MachinesModel,
  GridClient,
  GatewayNameModel,
  NetworkModel,
  generateString
} = window.configs?.grid3_client ?? {};

export default async function deployFunkwhale(data: VM, profile: IProfile) {
  const { envs, disks, ...base } = data;
  let { name, flist, cpu, memory, entrypoint, network: nw } = base;
  const { publicIp, planetary, nodeId, rootFsSize } = base;
  const { mnemonics, storeSecret, networkEnv } = profile;

  const http = new HTTPMessageBusClient(0, "");
  const client = new GridClient(
    networkEnv as any,
    mnemonics,
    storeSecret,
    http,
    undefined,
    "tfkvstore" as any
  );

  await client.connect();

  // sub deployments model (vm, disk, net): <type><random_suffix>
  let randomSuffix = generateString(10).toLowerCase();

  // gateway model: <solution-type><twin-id><solution_name>
  let domainName = await getUniqueDomainName(client, "fw", name);

  // Dynamically select node to deploy the gateway
  let [publicNodeId, nodeDomain] = await selectGatewayNode();
  const domain = `${domainName}.${nodeDomain}`;


  // define network
  const network = new NetworkModel();
  network.name = `net${randomSuffix}`;
  network.ip_range = "10.1.0.0/16";

  await deployFunkwhaleVM(profile, client, name, network, nodeId, domain, randomSuffix);

  const info = await getFunkwhaleInfo(client, name);
  const planetaryIP = info[0]["planetary"];

  await deployPrefixGateway(profile, client, domainName, planetaryIP, publicNodeId);

  const gatewayInfo = await getGatewayInfo(client, domainName);
  return { domain, planetaryIP };
}

async function deployFunkwhaleVM(
  profile: IProfile,
  client: any,
  name: string,
  network: any,
  nodeId: number,
  domain: string,
  randomSuffix: string
) {
  const disk = new DiskModel();
  disk.name = `disk${randomSuffix}`;
  disk.size = 10;
  disk.mountpoint = "/data";

  const vm = new MachineModel();
  vm.name = `vm${randomSuffix}`;
  vm.node_id = nodeId;
  vm.disks = [disk];
  vm.public_ip = false;
  vm.planetary = true;
  vm.cpu = 2;
  vm.memory = 1024 * 2;
  vm.rootfs_size = 2;
  vm.flist = "https://hub.grid.tf/tf-official-apps/threefoldtech-funk-latest.flist";
  vm.entrypoint = "/init.sh";
  vm.env = {
    FUNKWHALE_HOSTNAME: domain,
  };

  const vms = new MachinesModel();
  vms.name = name;
  vms.network = network;
  vms.machines = [vm];

  return deploy(profile, "Funkwhale", name, (grid) => {
    return grid.machines
      .deploy(vms)
      .then(() => grid.machines.getObj(name))
      .then(([vm]) => vm);
  });
}

async function deployPrefixGateway(
  profile: IProfile,
  client: any,
  domainName: string,
  backend: string,
  publicNodeId: number
) {
  const gw = new GatewayNameModel();
  gw.name = domainName;
  gw.node_id = publicNodeId;
  gw.tls_passthrough = false;
  gw.backends = [`http://[${backend}]:80/`];

  return deploy(profile, "GatewayName", domainName, (grid) => {
    return grid.gateway
      .deploy_name(gw)
      .then(() => grid.gateway.getObj(domainName))
      .then(([gw]) => gw);
  });
}

async function getFunkwhaleInfo(client: any, name: string) {
  const info = await client.machines.getObj(name);
  return info;
}

async function getGatewayInfo(client: any, name: string) {
  const info = await client.gateway.getObj(name);
  return info;
}
