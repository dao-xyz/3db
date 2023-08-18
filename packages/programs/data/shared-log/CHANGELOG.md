# Changelog

### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @peerbit/program bumped from 1.0.0 to 1.0.1
    * @peerbit/log bumped from 1.0.0 to 1.0.1
    * @peerbit/rpc bumped from 1.0.0 to 1.0.1
  * devDependencies
    * @peerbit/test-utils bumped from ^1.0.0 to ^1.0.1

### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @peerbit/log bumped from 1.0.1 to 1.0.2
    * @peerbit/rpc bumped from 1.0.1 to 1.0.2
  * devDependencies
    * @peerbit/test-utils bumped from ^1.0.1 to ^1.0.2

### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @peerbit/log bumped from 1.0.2 to 1.0.3
    * @peerbit/rpc bumped from 1.0.2 to 1.0.3
  * devDependencies
    * @peerbit/test-utils bumped from ^1.0.2 to ^1.0.3

### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @peerbit/program bumped from 1.0.1 to 1.0.2
    * @peerbit/log bumped from 1.0.3 to 1.0.4
    * @peerbit/rpc bumped from 1.0.3 to 1.0.4
  * devDependencies
    * @peerbit/test-utils bumped from ^1.0.3 to ^1.0.4

### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @peerbit/log bumped from 1.0.5 to 1.0.6
    * @peerbit/rpc bumped from 1.0.5 to 1.0.6
  * devDependencies
    * @peerbit/test-utils bumped from ^1.0.5 to ^1.0.6

### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @peerbit/program bumped from 1.0.3 to 1.0.4
    * @peerbit/log bumped from 1.0.6 to 1.0.7
    * @peerbit/rpc bumped from 1.0.6 to 1.0.7
  * devDependencies
    * @peerbit/test-utils bumped from ^1.0.6 to ^1.0.7

### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @peerbit/log bumped from 1.0.7 to 1.0.8
    * @peerbit/rpc bumped from 1.0.7 to 1.0.8
  * devDependencies
    * @peerbit/test-utils bumped from ^1.0.7 to ^1.0.8

### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @peerbit/log bumped from 1.0.8 to 1.0.9
    * @peerbit/rpc bumped from 1.0.8 to 1.0.9
  * devDependencies
    * @peerbit/test-utils bumped from ^1.0.8 to ^1.0.9

### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @peerbit/rpc bumped from 1.0.9 to 1.0.10

### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @peerbit/log bumped from 1.0.10 to 1.0.11
    * @peerbit/rpc bumped from 1.0.11 to 1.0.12
  * devDependencies
    * @peerbit/test-utils bumped from ^1.0.10 to ^1.0.11

### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @peerbit/log bumped from 1.0.11 to 1.0.12
    * @peerbit/rpc bumped from 1.0.12 to 1.0.13
  * devDependencies
    * @peerbit/test-utils bumped from ^1.0.11 to ^1.0.12

### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @peerbit/program bumped from 2.0.0 to 2.1.0
    * @peerbit/log bumped from 1.0.14 to 1.0.15
    * @peerbit/rpc bumped from 2.0.0 to 2.0.1
  * devDependencies
    * @peerbit/test-utils bumped from ^1.0.14 to ^1.0.15

### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @peerbit/program bumped from 2.2.0 to 2.2.1
    * @peerbit/log bumped from 2.0.0 to 2.0.1
    * @peerbit/rpc bumped from 2.1.0 to 2.1.1
  * devDependencies
    * @peerbit/test-utils bumped from ^1.0.16 to ^1.0.17

### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @peerbit/program bumped from 2.2.1 to 2.2.2
    * @peerbit/log bumped from 2.0.1 to 2.0.2
    * @peerbit/rpc bumped from 2.1.1 to 2.1.2
  * devDependencies
    * @peerbit/test-utils bumped from ^1.0.17 to ^1.0.18

### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @peerbit/program bumped from 2.2.2 to 2.2.3
    * @peerbit/log bumped from 2.0.2 to 2.0.3
    * @peerbit/rpc bumped from 2.1.2 to 2.1.3
  * devDependencies
    * @peerbit/test-utils bumped from ^1.0.18 to ^1.0.19

## [3.0.0](https://github.com/dao-xyz/peerbit/compare/shared-log-v2.0.1...shared-log-v3.0.0) (2023-08-06)


### ⚠ BREAKING CHANGES

* canPerform callback that allows peers to filter allowed operations
* replication degree on commit level

### Features

* allow updating role while open ([4fe384d](https://github.com/dao-xyz/peerbit/commit/4fe384d079d2bc3afeb2294d024eb8b49009ea00))
* canPerform callback that allows peers to filter allowed operations ([923908d](https://github.com/dao-xyz/peerbit/commit/923908d22d2c1aeceba62cb598deab6c417ba669))
* replication degree on commit level ([cba04ef](https://github.com/dao-xyz/peerbit/commit/cba04efe955b67df73256b23ecb5a13ba6b76ee5))
* support for canReplicate filter ([432e6a5](https://github.com/dao-xyz/peerbit/commit/432e6a55b88eac5dd2d036338bf2e51cef2670f3))


### Bug Fixes

* add replication re-organization checks ([03954ba](https://github.com/dao-xyz/peerbit/commit/03954badc55c4e36e3459cc13be7b711b61e1cb5))
* cache resolving parents with unique gids ([128a2ea](https://github.com/dao-xyz/peerbit/commit/128a2ea426843bf3326340cf25508a8cec82cb8a))
* export append options ([44b7a2e](https://github.com/dao-xyz/peerbit/commit/44b7a2ecbf69d8915d6797a5abdb2b7b25596b08))
* make sure pendingDeletes are not interfering with reopens ([b8f3bb4](https://github.com/dao-xyz/peerbit/commit/b8f3bb4b2c6edbb75c655bb7f4972d654f85bbf9))
* remove pending IHave response handlers after timeout ([1a65fb8](https://github.com/dao-xyz/peerbit/commit/1a65fb8aaf31ef253a74eff5135cfdb481892f96))
* rename replication types ([42ade4f](https://github.com/dao-xyz/peerbit/commit/42ade4fe45a5139c72019de8b982589a83731954))
* simplify QueryContext ([86ae518](https://github.com/dao-xyz/peerbit/commit/86ae5187bf6cc8a894a6b7f160415ceb6b3cb64d))
* simplify tests ([a73b33f](https://github.com/dao-xyz/peerbit/commit/a73b33f53b83bf12e89d4c02a473b7abe7777a9d))
* typo change recieve to receive ([9b05cfc](https://github.com/dao-xyz/peerbit/commit/9b05cfc9220f6d8206626f5208724e3d0f34abe2))
* update error message ([8c90343](https://github.com/dao-xyz/peerbit/commit/8c90343236011d835b7739c8da7c69b1ee3d0582))
* verify remote signatures by default ([ce96816](https://github.com/dao-xyz/peerbit/commit/ce968166d9d1b168cc5087052427ba9de33b4d2a))
* wait for replicating entry before notifying peers ([2b79612](https://github.com/dao-xyz/peerbit/commit/2b79612766437fd51e48dcad0b7c624b6e322145))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @peerbit/program bumped from 2.1.0 to 2.2.0
    * @peerbit/log bumped from 1.0.15 to 2.0.0
    * @peerbit/rpc bumped from 2.0.1 to 2.1.0
  * devDependencies
    * @peerbit/test-utils bumped from ^1.0.15 to ^1.0.16

## [2.0.0](https://github.com/dao-xyz/peerbit/compare/shared-log-v1.1.9...shared-log-v2.0.0) (2023-07-18)


### ⚠ BREAKING CHANGES

* remove ComposableProgram type

### Features

* remove ComposableProgram type ([4ccf6c2](https://github.com/dao-xyz/peerbit/commit/4ccf6c2ce07d7edfe1608e9bd5adfa03cf587dd4))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @peerbit/program bumped from 1.0.6 to 2.0.0
    * @peerbit/log bumped from 1.0.13 to 1.0.14
    * @peerbit/rpc bumped from 1.0.14 to 2.0.0
    * @peerbit/time bumped from 1.0.1 to 1.0.2
  * devDependencies
    * @peerbit/test-utils bumped from ^1.0.13 to ^1.0.14

## [1.1.9](https://github.com/dao-xyz/peerbit/compare/shared-log-v1.1.8...shared-log-v1.1.9) (2023-07-04)


### Bug Fixes

* rm postbuild script ([b627bf0](https://github.com/dao-xyz/peerbit/commit/b627bf0dcdb99d24ac8c9055586e72ea2d174fcc))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @peerbit/logger bumped from 1.0.0 to 1.0.1
    * @peerbit/program bumped from 1.0.5 to 1.0.6
    * @peerbit/log bumped from 1.0.12 to 1.0.13
    * @peerbit/rpc bumped from 1.0.13 to 1.0.14
    * @peerbit/time bumped from 1.0.0 to 1.0.1
  * devDependencies
    * @peerbit/test-utils bumped from ^1.0.12 to ^1.0.13

## [1.1.6](https://github.com/dao-xyz/peerbit/compare/shared-log-v1.1.5...shared-log-v1.1.6) (2023-07-03)


### Bug Fixes

* check super drop before dropping log ([2218b00](https://github.com/dao-xyz/peerbit/commit/2218b0041973aa1311477fb96f661ec94804e723))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @peerbit/program bumped from 1.0.4 to 1.0.5
    * @peerbit/log bumped from 1.0.9 to 1.0.10
    * @peerbit/rpc bumped from 1.0.10 to 1.0.11
  * devDependencies
    * @peerbit/test-utils bumped from ^1.0.9 to ^1.0.10

## [1.1.0](https://github.com/dao-xyz/peerbit/compare/shared-log-v1.0.5...shared-log-v1.1.0) (2023-06-29)


### Features

* include age in replicator info ([2adf246](https://github.com/dao-xyz/peerbit/commit/2adf246637ea42c7ce4b21db6cd48a8e9d24faf3))

## [1.0.5](https://github.com/dao-xyz/peerbit/compare/shared-log-v1.0.4...shared-log-v1.0.5) (2023-06-29)


### Bug Fixes

* rn SubscriptionType to Role ([c92c83f](https://github.com/dao-xyz/peerbit/commit/c92c83f8a991995744401c56018d2a800d9b235e))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @peerbit/program bumped from 1.0.2 to 1.0.3
    * @peerbit/log bumped from 1.0.4 to 1.0.5
    * @peerbit/rpc bumped from 1.0.4 to 1.0.5
  * devDependencies
    * @peerbit/test-utils bumped from ^1.0.4 to ^1.0.5

## 1.0.0 (2023-06-28)


### ⚠ BREAKING CHANGES

* rename org on utility modules
* Uint8array as default encoding for logs
* client abstraction

### Features

* client abstraction ([6a1226d](https://github.com/dao-xyz/peerbit/commit/6a1226d4f8fc6deb167bff86cf7bdd6227c01a6b))
* Uint8array as default encoding for logs ([f87f594](https://github.com/dao-xyz/peerbit/commit/f87f5940e1ae0406c4b2a715449b68079f50df5c))


### Bug Fixes

* remove uneccessary interface module ([1a24f62](https://github.com/dao-xyz/peerbit/commit/1a24f62f77fe6777628512fbb719bd78ad9080af))
* rename org on utility modules ([0e09c8a](https://github.com/dao-xyz/peerbit/commit/0e09c8a29487205e02e45cc7f1e214450f96cb38))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @peerbit/program bumped from 1.0.4 to 1.0.0
    * @peerbit/log bumped from 1.0.4 to 1.0.0
    * @peerbit/rpc bumped from 1.0.4 to 1.0.0
  * devDependencies
    * @peerbit/test-utils bumped from ^1.0.4 to ^1.0.0
