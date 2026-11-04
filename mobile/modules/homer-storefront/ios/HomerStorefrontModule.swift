import ExpoModulesCore
import StoreKit

public class HomerStorefrontModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HomerStorefront")
    AsyncFunction("current") { () async -> String? in
      await Storefront.current?.countryCode
    }
  }
}
