{
  description = "Dev shell with bleeding-edge yt-dlp master";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    yt-dlp-src = {
      url = "github:yt-dlp/yt-dlp";
      flake = false;
    };
  };

  outputs = { self, nixpkgs, yt-dlp-src }:
    let
      supportedSystems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
    in
    {
      devShells = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          yt-dlp-latest = pkgs.yt-dlp.overrideAttrs (oldAttrs: {
            version = "master";
            src = yt-dlp-src;
          });
        in
        {
          default = pkgs.mkShell {
            packages = [
              yt-dlp-latest
              pkgs.ffmpeg
            ];
          };
        });
    };
}
